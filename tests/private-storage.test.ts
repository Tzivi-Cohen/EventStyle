import { v2 as cloudinary } from 'cloudinary';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUDINARY_UPLOAD_OPTIONS,
  CloudinaryStorage,
  DisabledStorage,
  MAX_PRIVATE_DOWNLOAD_TTL_SECONDS,
  PRIVATE_DOWNLOAD_TTL_SECONDS,
  removeImagesSafely,
  setImageStorage,
  type ImageStorage,
} from '../src/services/storage/imageStorage';
import { api, createAdmin, eventBody, PNG_BUFFER, prisma, resetDatabase, storage } from './helpers';

/** פרטי התחברות מדומים לבדיקות בלבד – לא חשבון אמיתי. אין שום פנייה לרשת */
const TEST_CREDENTIALS = { cloud_name: 'test-cloud', api_key: '123456789012345', api_secret: 'test-api-secret-never-exposed' };
const file = { buffer: Buffer.from('processed-image-bytes'), mimetype: 'image/jpeg', originalname: 'a.jpg' } as Express.Multer.File;

/** מדמה את upload_stream של Cloudinary: שומר את ההגדרות ומחזיר תוצאה או שגיאה */
function mockUploadStream(result: Record<string, unknown> | null, error?: Error) {
  const captured: { options?: Record<string, unknown>; data?: Buffer } = {};
  vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((options: Record<string, unknown>, callback: (e: unknown, r: unknown) => void) => {
    captured.options = options;
    return {
      end: (data: Buffer) => {
        captured.data = data;
        callback(error, result ?? undefined);
      },
    };
  }) as never);
  return captured;
}

afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('CloudinaryStorage.upload', () => {
  it('default (no options) keeps the existing public upload: identical Cloudinary options and result', async () => {
    const captured = mockUploadStream({ type: 'upload', secure_url: 'https://res.cloudinary.test/pub.jpg', public_id: 'eventstyle/gallery/pub', format: 'jpg' });
    const stored = await new CloudinaryStorage(TEST_CREDENTIALS).upload(file, 'gallery');
    expect(captured.options).toEqual({ ...CLOUDINARY_UPLOAD_OPTIONS, folder: 'eventstyle/gallery' });
    expect(captured.options).not.toHaveProperty('type');
    expect(captured.data).toBe(file.buffer);
    expect(stored).toEqual({ url: 'https://res.cloudinary.test/pub.jpg', publicId: 'eventstyle/gallery/pub' });
  });

  it('explicit access "public" behaves exactly like the default', async () => {
    const captured = mockUploadStream({ type: 'upload', secure_url: 'https://res.cloudinary.test/p.jpg', public_id: 'eventstyle/x/p', format: 'jpg' });
    const stored = await new CloudinaryStorage(TEST_CREDENTIALS).upload(file, 'x', { access: 'public' });
    expect(captured.options).toEqual({ ...CLOUDINARY_UPLOAD_OPTIONS, folder: 'eventstyle/x' });
    expect(stored).toEqual({ url: 'https://res.cloudinary.test/p.jpg', publicId: 'eventstyle/x/p' });
  });

  it('access "authenticated" uploads as type authenticated with all the existing protections', async () => {
    const captured = mockUploadStream({
      type: 'authenticated',
      secure_url: 'https://res.cloudinary.test/image/authenticated/s--SIGNED--/v1/eventstyle/events/1/abc.jpg',
      public_id: 'eventstyle/events/1/abc',
      format: 'jpg',
    });
    const stored = await new CloudinaryStorage(TEST_CREDENTIALS).upload(file, 'events/1', { access: 'authenticated' });
    expect(captured.options).toEqual({ ...CLOUDINARY_UPLOAD_OPTIONS, folder: 'eventstyle/events/1', type: 'authenticated' });
    expect(stored).toEqual({ access: 'authenticated', publicId: 'eventstyle/events/1/abc', format: 'jpg' });
  });

  it('never returns the permanent signed URL of an authenticated upload', async () => {
    mockUploadStream({ type: 'authenticated', secure_url: 'https://res.cloudinary.test/s--PERMANENT--/abc.jpg', url: 'http://x/s--PERMANENT--/abc.jpg', public_id: 'eventstyle/e/abc', format: 'png' });
    const stored = await new CloudinaryStorage(TEST_CREDENTIALS).upload(file, 'e', { access: 'authenticated' });
    expect(stored).not.toHaveProperty('url');
    expect(stored).not.toHaveProperty('secure_url');
    expect(JSON.stringify(stored)).not.toContain('PERMANENT');
  });

  it('if Cloudinary stores a "private" upload as public, the file is deleted and the upload fails (502)', async () => {
    mockUploadStream({ type: 'upload', secure_url: 'https://res.cloudinary.test/oops.jpg', public_id: 'eventstyle/e/oops', format: 'jpg' });
    const destroy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    await expect(new CloudinaryStorage(TEST_CREDENTIALS).upload(file, 'e', { access: 'authenticated' })).rejects.toMatchObject({
      status: 502,
      code: 'UPLOAD_FAILED',
    });
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledWith('eventstyle/e/oops', { resource_type: 'image', type: 'upload', invalidate: true }));
  });

  it.each(['public', 'authenticated'] as const)('a Cloudinary error on a %s upload returns 502 UPLOAD_FAILED', async (access) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockUploadStream(null, new Error('network down'));
    const storageUnderTest = new CloudinaryStorage(TEST_CREDENTIALS);
    const upload = access === 'public' ? storageUnderTest.upload(file, 'g') : storageUnderTest.upload(file, 'g', { access: 'authenticated' });
    await expect(upload).rejects.toMatchObject({ status: 502, code: 'UPLOAD_FAILED' });
  });
});

describe('CloudinaryStorage.getPrivateDownloadUrl', () => {
  const storageUnderTest = () => new CloudinaryStorage(TEST_CREDENTIALS);

  it(`creates a signed, server-side download link for an authenticated file, valid for ${PRIVATE_DOWNLOAD_TTL_SECONDS / 60} minutes by default`, () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = Math.floor(Date.now() / 1000);
    const link = storageUnderTest().getPrivateDownloadUrl('eventstyle/events/1/abc', 'jpg');
    const url = new URL(link.url);

    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('api.cloudinary.com');
    expect(url.pathname).toBe('/v1_1/test-cloud/image/download');
    expect(url.searchParams.get('public_id')).toBe('eventstyle/events/1/abc');
    expect(url.searchParams.get('format')).toBe('jpg');
    expect(url.searchParams.get('type')).toBe('authenticated');
    const expiresAt = Number(url.searchParams.get('expires_at'));
    expect(expiresAt - before).toBeGreaterThanOrEqual(PRIVATE_DOWNLOAD_TTL_SECONDS);
    expect(expiresAt - before).toBeLessThanOrEqual(PRIVATE_DOWNLOAD_TTL_SECONDS + 2);
    expect(link.expiresAt.getTime()).toBe(expiresAt * 1000);
    expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]{40,64}$/);
    expect(fetchSpy).not.toHaveBeenCalled(); // נוצר מקומית, בלי פנייה לרשת
  });

  it('never exposes the API secret (only the public API key, a signature and an expiry)', () => {
    const { url } = storageUnderTest().getPrivateDownloadUrl('eventstyle/e/abc', 'png');
    expect(url).not.toContain(TEST_CREDENTIALS.api_secret);
    expect(new URL(url).searchParams.has('api_secret')).toBe(false);
    expect([...new URL(url).searchParams.keys()].sort()).toEqual(['api_key', 'expires_at', 'format', 'public_id', 'signature', 'timestamp', 'type']);
  });

  it('the signature covers the expiry: editing expires_at breaks it', () => {
    const url = new URL(storageUnderTest().getPrivateDownloadUrl('eventstyle/e/abc', 'webp').url);
    const params = Object.fromEntries(['expires_at', 'format', 'public_id', 'timestamp', 'type'].map((k) => [k, url.searchParams.get(k)!]));
    const sign = (p: Record<string, string>) => cloudinary.utils.api_sign_request(p, TEST_CREDENTIALS.api_secret);

    expect(url.searchParams.get('signature')).toBe(sign(params));
    expect(sign({ ...params, expires_at: String(Number(params.expires_at) + 3600) })).not.toBe(url.searchParams.get('signature'));
  });

  it('accepts a custom expiry within the allowed range', () => {
    const before = Math.floor(Date.now() / 1000);
    const link = storageUnderTest().getPrivateDownloadUrl('eventstyle/e/abc', 'jpg', { expiresInSeconds: 60 });
    expect(Math.floor(link.expiresAt.getTime() / 1000) - before).toBeGreaterThanOrEqual(60);
    expect(Math.floor(link.expiresAt.getTime() / 1000) - before).toBeLessThanOrEqual(62);
  });

  it.each([0, -5, 1.5, MAX_PRIVATE_DOWNLOAD_TTL_SECONDS + 1])('rejects an invalid expiry (%s seconds)', (expiresInSeconds) => {
    expect(() => storageUnderTest().getPrivateDownloadUrl('eventstyle/e/abc', 'jpg', { expiresInSeconds })).toThrow(/expiresInSeconds/);
  });

  it('rejects a missing publicId and an unsupported format', () => {
    expect(() => storageUnderTest().getPrivateDownloadUrl('', 'jpg')).toThrow(/publicId/);
    expect(() => storageUnderTest().getPrivateDownloadUrl('eventstyle/e/abc', 'gif')).toThrow(/format/);
  });
});

describe('CloudinaryStorage.remove', () => {
  it('public (default) deletes the existing way plus CDN invalidation', async () => {
    const destroy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    await new CloudinaryStorage(TEST_CREDENTIALS).remove('eventstyle/gallery/pub');
    expect(destroy).toHaveBeenCalledWith('eventstyle/gallery/pub', { resource_type: 'image', type: 'upload', invalidate: true });
  });

  it('authenticated deletes the private file with type authenticated and invalidation', async () => {
    const destroy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    await new CloudinaryStorage(TEST_CREDENTIALS).remove('eventstyle/events/1/abc', { access: 'authenticated' });
    expect(destroy).toHaveBeenCalledWith('eventstyle/events/1/abc', { resource_type: 'image', type: 'authenticated', invalidate: true });
  });

  it('a Cloudinary error is propagated by remove()', async () => {
    vi.spyOn(cloudinary.uploader, 'destroy').mockRejectedValue(new Error('cloud error'));
    await expect(new CloudinaryStorage(TEST_CREDENTIALS).remove('eventstyle/x')).rejects.toThrow('cloud error');
  });
});

describe('removeImagesSafely', () => {
  afterEach(() => setImageStorage(storage));

  it('passes the storage type, skips empty ids, and never throws when one deletion fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls: { id: string; access?: string }[] = [];
    const flaky = {
      remove: async (id: string, options?: { access?: string }) => {
        calls.push({ id, access: options?.access });
        if (id === 'bad') throw new Error('boom');
      },
    } as unknown as ImageStorage;
    setImageStorage(flaky);

    await expect(removeImagesSafely(['good', null, 'bad'], { access: 'authenticated' })).resolves.toBeUndefined();
    expect(calls).toEqual([
      { id: 'good', access: 'authenticated' },
      { id: 'bad', access: 'authenticated' },
    ]);
  });

  it('without options keeps the existing behaviour (public)', async () => {
    const calls: { id: string; access?: string }[] = [];
    setImageStorage({ remove: async (id: string, options?: { access?: string }) => void calls.push({ id, access: options?.access }) } as unknown as ImageStorage);
    await removeImagesSafely(['a']);
    expect(calls).toEqual([{ id: 'a', access: undefined }]); // remove() מפרש undefined כ-public
  });
});

describe('DisabledStorage (Cloudinary not configured)', () => {
  it('public and authenticated uploads and download links return 503; remove is a no-op', async () => {
    const disabled = new DisabledStorage();
    await expect(disabled.upload(file, 'g')).rejects.toMatchObject({ status: 503, code: 'STORAGE_NOT_CONFIGURED' });
    await expect(disabled.upload(file, 'g', { access: 'authenticated' })).rejects.toMatchObject({ status: 503 });
    expect(() => disabled.getPrivateDownloadUrl()).toThrow(expect.objectContaining({ status: 503, code: 'STORAGE_NOT_CONFIGURED' }));
    await expect(disabled.remove()).resolves.toBeUndefined();
  });
});

describe('Backward compatibility – existing endpoints still use public storage', () => {
  let adminAuth: string;
  beforeEach(async () => {
    await resetDatabase();
    adminAuth = (await createAdmin()).auth;
  });

  it('gallery upload and delete: public upload, public delete', async () => {
    const res = await api.post('/api/gallery').set('Authorization', adminAuth).field('title', 'Compat').field('category', 'Brit').attach('image', PNG_BUFFER, 'c.png');
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/cdn\.test\//);
    expect(storage.uploadAccess).toEqual(['public']);

    await api.delete(`/api/gallery/${res.body.id}`).set('Authorization', adminAuth).expect(204);
    expect(storage.removedWith).toEqual([{ publicId: res.body.publicId, access: 'public' }]);
  });

  it('event photos upload and delete (admin): public upload, public delete', async () => {
    const event = await api.post('/api/events').set('Authorization', adminAuth).send(eventBody()).expect(201);
    const up = await api.post(`/api/events/${event.body.id}/photos`).set('Authorization', adminAuth).attach('photos', PNG_BUFFER, 'p.png');
    expect(up.status).toBe(201);
    expect(storage.uploadAccess).toEqual(['public']);
    expect(up.body[0].url).toMatch(/^https:\/\/cdn\.test\//);

    await api.delete(`/api/events/${event.body.id}/photos/${up.body[0].id}`).set('Authorization', adminAuth).expect(204);
    expect(storage.removedWith).toEqual([{ publicId: up.body[0].publicId, access: 'public' }]);
  });
});
