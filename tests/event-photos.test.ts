import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisabledStorage, PRIVATE_DOWNLOAD_TTL_SECONDS, setImageStorage } from '../src/services/storage/imageStorage';
import { MAX_PHOTOS_PER_EVENT } from '../src/services/photos.service';
import { PNG_BUFFER, api, createAdmin, createUser, eventBody, prisma, resetDatabase, storage } from './helpers';

/** תמונות אירוע פרטיות: הרשאות, קישורים זמניים, מגבלות, כפילויות, כשלים ותאימות לאחור */

type Auth = { auth: string; user: { id: number } };
let admin: Auth;
let owner: Auth;
let other: Auth;
let eventId: number;
let otherEventId: number;
let orphanEventId: number;

/** תמונת PNG קטנה ושונה לכל seed (תוכן שונה = Hash שונה) */
const png = (seed: number) =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed % 256, g: (seed * 7) % 256, b: (seed * 13) % 256 } } })
    .png()
    .toBuffer();

const SECRET = 'SECRET-GPS-OWNER-998877';
/** אותם פיקסלים, מטא-דאטה שונה – אחרי העיבוד (הסרת המטא-דאטה) הקבצים זהים */
const jpegWithExif = (artist: string) =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: '#88aa22' } })
    .withExif({
      IFD0: { Artist: artist, Copyright: SECRET },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '32/1 4/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '34/1 46/1 50/1' },
    })
    .jpeg()
    .toBuffer();

function upload(auth: string, id: number, files: Buffer[], contentType = 'image/png') {
  let req = api.post(`/api/events/${id}/photos`).set('Authorization', auth);
  files.forEach((buffer, i) => {
    req = req.attach('photos', buffer, { filename: `p${i}.${contentType === 'image/jpeg' ? 'jpg' : 'png'}`, contentType });
  });
  return req;
}

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
/** שורות תמונה ישירות במסד (למשל כדי למלא אירוע עד המגבלה) */
const fillPhotos = (id: number, count: number) =>
  prisma.eventPhoto.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      eventId: id,
      url: 'authenticated:png',
      publicId: `seeded/${i}`,
      storageType: 'authenticated' as const,
      contentHash: sha256(Buffer.from(`seeded-${id}-${i}`)),
    })),
  });

const INTERNAL_FIELDS = ['publicId', 'storageType', 'uploadedById', 'contentHash', 'galleryItemId'];

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
  owner = await createUser({ email: 'owner@test.com' });
  other = await createUser({ email: 'other@test.com' });
  eventId = (await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'owner@test.com' }))).body.id;
  otherEventId = (await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'other@test.com' }))).body.id;
  orphanEventId = (await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'nobody@test.com' }))).body.id;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => prisma.$disconnect());

describe('Private upload by the event owner', () => {
  it('owner uploads: stored as authenticated, response has a temporary link and no storage internals', async () => {
    const res = await upload(owner.auth, eventId, [PNG_BUFFER]);
    expect(res.status).toBe(201);
    expect(storage.uploadAccess).toEqual(['authenticated']);
    const [photo] = res.body;
    expect(photo).toMatchObject({
      eventId,
      url: expect.stringMatching(/^https:\/\/private\.test\//),
      isPrivate: true,
      publishConsent: false,
      publishedInGallery: false,
      uploadedByMe: true,
      canDelete: true,
    });
    for (const field of INTERNAL_FIELDS) expect(photo).not.toHaveProperty(field);

    const ttl = (new Date(photo.urlExpiresAt).getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(PRIVATE_DOWNLOAD_TTL_SECONDS - 10);
    expect(ttl).toBeLessThanOrEqual(PRIVATE_DOWNLOAD_TTL_SECONDS);

    const row = await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    expect(row).toMatchObject({ storageType: 'authenticated', uploadedById: owner.user.id, publishConsent: false, url: 'authenticated:png' });
    // SHA-256 של הקובץ המעובד – בדיוק הקובץ שהגיע לאחסון
    expect(row.contentHash).toBe(sha256(storage.files[0].buffer));
    expect(JSON.stringify(res.body)).not.toContain(row.contentHash!);
    expect(JSON.stringify(res.body)).not.toContain('authenticated:'); // ההפניה הפנימית לאחסון לא נשלחת
  });

  it('owner sees own photos (list, single, event details) with temporary links and no publicId', async () => {
    const up = await upload(owner.auth, eventId, [await png(1), await png(2)]);
    const list = await api.get(`/api/events/${eventId}/photos`).set('Authorization', owner.auth);
    expect(list.status).toBe(200);
    expect(list.body.map((p: { id: number }) => p.id)).toEqual(up.body.map((p: { id: number }) => p.id));

    const single = await api.get(`/api/events/${eventId}/photos/${up.body[0].id}`).set('Authorization', owner.auth);
    expect(single.status).toBe(200);
    expect(single.body.url).toMatch(/^https:\/\/private\.test\//);

    const details = await api.get(`/api/events/${eventId}`).set('Authorization', owner.auth);
    expect(details.body.photos).toHaveLength(2);
    for (const photo of [...list.body, single.body, ...details.body.photos]) {
      for (const field of INTERNAL_FIELDS) expect(photo).not.toHaveProperty(field);
    }
  });

  it('an expired link is replaced by requesting the photo again (fresh signature, new expiry)', async () => {
    const start = Math.floor(Date.now() / 1000) * 1000; // שעון מדומה קרוב לזמן האמיתי (ה-JWT בתוקף שעה)
    const minutes = (n: number) => new Date(start + n * 60_000).toISOString();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    const [photo] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    expect(photo.urlExpiresAt).toBe(minutes(10));

    vi.setSystemTime(start + 11 * 60_000); // הקישור הראשון פג
    const fresh = await api.get(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', owner.auth);
    expect(fresh.body.urlExpiresAt).toBe(minutes(21));
    expect(fresh.body.url).not.toBe(photo.url);
  });
});

describe('Access control (IDOR, ownership, admin)', () => {
  it('guest gets 401 on every photo endpoint', async () => {
    await api.get(`/api/events/${eventId}/photos`).expect(401);
    await api.post(`/api/events/${eventId}/photos`).attach('photos', PNG_BUFFER, 'a.png').expect(401);
    await api.get(`/api/events/${eventId}/photos/1`).expect(401);
    await api.delete(`/api/events/${eventId}/photos/1`).expect(401);
    await api.put(`/api/events/${eventId}/photos/1/consent`).send({ publishConsent: true }).expect(401);
    await api.post(`/api/events/${eventId}/photos/1/publish`).send({ title: 'x' }).expect(401);
    await api.get('/api/admin/event-photos').expect(401);
    expect(storage.uploads).toBe(0);
  });

  it("another client gets 403 on the owner's event – before any file is processed", async () => {
    const [photo] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    storage.reset();
    await api.get(`/api/events/${eventId}/photos`).set('Authorization', other.auth).expect(403);
    await upload(other.auth, eventId, [await png(5)]).expect(403);
    await api.get(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', other.auth).expect(403);
    await api.delete(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', other.auth).expect(403);
    await api.put(`/api/events/${eventId}/photos/${photo.id}/consent`).set('Authorization', other.auth).send({ publishConsent: true }).expect(403);
    expect(storage.uploads).toBe(0);
    expect(storage.files).toHaveLength(0);
    expect(await prisma.eventPhoto.count()).toBe(1);
  });

  it('a photo id from another event is never reachable through my event (404), nor through its own event (403)', async () => {
    const [foreign] = (await upload(admin.auth, otherEventId, [PNG_BUFFER])).body;
    await api.get(`/api/events/${eventId}/photos/${foreign.id}`).set('Authorization', owner.auth).expect(404);
    await api.delete(`/api/events/${eventId}/photos/${foreign.id}`).set('Authorization', owner.auth).expect(404);
    await api.put(`/api/events/${eventId}/photos/${foreign.id}/consent`).set('Authorization', owner.auth).send({ publishConsent: true }).expect(404);
    await api.get(`/api/events/${otherEventId}/photos/${foreign.id}`).set('Authorization', owner.auth).expect(403);
    expect(await prisma.eventPhoto.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ publishConsent: false });
  });

  it('an event without an owner is not accessible to a random client, only to the admin', async () => {
    await api.get(`/api/events/${orphanEventId}/photos`).set('Authorization', owner.auth).expect(403);
    await upload(owner.auth, orphanEventId, [PNG_BUFFER]).expect(403);
    await api.get(`/api/events/${orphanEventId}/photos`).set('Authorization', admin.auth).expect(200);
    await upload(admin.auth, orphanEventId, [PNG_BUFFER]).expect(201);
  });

  it('missing event → 404, invalid ids → 400', async () => {
    await api.get('/api/events/99999/photos').set('Authorization', owner.auth).expect(404);
    await upload(owner.auth, 99999, [PNG_BUFFER]).expect(404);
    await api.get(`/api/events/${eventId}/photos/99999`).set('Authorization', owner.auth).expect(404);
    await api.get('/api/events/abc/photos').set('Authorization', owner.auth).expect(400);
    await api.get(`/api/events/${eventId}/photos/0`).set('Authorization', owner.auth).expect(400);
  });

  it('admin sees, uploads and deletes photos of any event, and gets the internal fields', async () => {
    const [mine] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    const [byAdmin] = (await upload(admin.auth, eventId, [await png(9)])).body;
    expect(storage.uploadAccess).toEqual(['authenticated', 'authenticated']);
    expect(byAdmin).toMatchObject({ storageType: 'authenticated', uploadedById: admin.user.id, galleryItemId: null, publicId: expect.any(String) });

    const view = await api.get(`/api/events/${eventId}/photos/${mine.id}`).set('Authorization', admin.auth);
    expect(view.body).toMatchObject({ uploadedById: owner.user.id, uploadedByMe: false, canDelete: true, url: expect.stringMatching(/^https:\/\/private\.test\//) });

    await api.delete(`/api/events/${eventId}/photos/${mine.id}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removedWith).toEqual([{ publicId: view.body.publicId, access: 'authenticated' }]);
  });

  it('client deletes only photos she uploaded; admin uploads in her event are protected (403)', async () => {
    const [mine] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    const [byAdmin] = (await upload(admin.auth, eventId, [await png(3)])).body;
    const list = await api.get(`/api/events/${eventId}/photos`).set('Authorization', owner.auth);
    expect(list.body.find((p: { id: number }) => p.id === byAdmin.id)).toMatchObject({ uploadedByMe: false, canDelete: false });

    const denied = await api.delete(`/api/events/${eventId}/photos/${byAdmin.id}`).set('Authorization', owner.auth);
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/only photos you uploaded/);
    await api.delete(`/api/events/${eventId}/photos/${mine.id}`).set('Authorization', owner.auth).expect(204);
    await api.delete(`/api/events/${eventId}/photos/${mine.id}`).set('Authorization', owner.auth).expect(404);
    expect(await prisma.eventPhoto.findMany({ select: { id: true } })).toEqual([{ id: byAdmin.id }]);
  });

  it('when the event is reassigned to another client, the previous owner loses access', async () => {
    const [photo] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    await api.put(`/api/events/${eventId}`).set('Authorization', admin.auth).send(eventBody({ clientEmail: 'other@test.com' })).expect(200);
    await api.get(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', owner.auth).expect(403);
    await api.get(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', other.auth).expect(200);
  });
});

describe('Limit of 50 photos per event', () => {
  it(`rejects a request that would exceed ${MAX_PHOTOS_PER_EVENT} photos, before uploading anything`, async () => {
    await fillPhotos(eventId, MAX_PHOTOS_PER_EVENT - 1);
    const res = await upload(owner.auth, eventId, [await png(1), await png(2)]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PHOTO_LIMIT_REACHED', details: { limit: 50, current: 49, requested: 2 } });
    expect(storage.uploads).toBe(0);

    await upload(owner.auth, eventId, [await png(1)]).expect(201);
    const full = await upload(owner.auth, eventId, [await png(2)]);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('PHOTO_LIMIT_REACHED');
    expect(storage.files).toHaveLength(1); // הבקשה האחרונה נדחתה לפני עיבוד הקבצים
    expect(await prisma.eventPhoto.count({ where: { eventId } })).toBe(50);
  });

  it('parallel uploads cannot pass the limit together; the loser’s uploaded files are removed', async () => {
    await fillPhotos(eventId, MAX_PHOTOS_PER_EVENT - 1);
    const [a, b] = await Promise.all([upload(owner.auth, eventId, [await png(1)]), upload(admin.auth, eventId, [await png(2)])]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.eventPhoto.count({ where: { eventId } })).toBe(50);
    expect(storage.uploads - storage.removed.length).toBe(1);
  });

  it('the limit is per event', async () => {
    await fillPhotos(eventId, MAX_PHOTOS_PER_EVENT);
    await upload(admin.auth, otherEventId, [PNG_BUFFER]).expect(201);
  });
});

describe('Duplicate photos (SHA-256 of the processed image)', () => {
  it('the same file twice in one request → 409, nothing uploaded', async () => {
    const res = await upload(owner.auth, eventId, [PNG_BUFFER, PNG_BUFFER]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PHOTO');
    expect(storage.uploads).toBe(0);
  });

  it('a file already in the event → 409 with the existing photo id; other events are not affected', async () => {
    const [first] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    const again = await upload(admin.auth, eventId, [await png(4), PNG_BUFFER]);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'DUPLICATE_PHOTO', details: { duplicates: [{ file: 'p1.png', photoId: first.id }] } });
    expect(storage.uploads).toBe(1);
    await upload(admin.auth, otherEventId, [PNG_BUFFER]).expect(201);
  });

  it('the same picture with different metadata is still a duplicate (hash is taken after metadata removal)', async () => {
    await upload(owner.auth, eventId, [await jpegWithExif('Camera A')], 'image/jpeg').expect(201);
    const res = await upload(owner.auth, eventId, [await jpegWithExif('Camera B')], 'image/jpeg');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PHOTO');
  });

  it('parallel uploads of the same file: exactly one is saved, the other file is removed from storage', async () => {
    const image = await png(77);
    const results = await Promise.all([upload(owner.auth, eventId, [image]), upload(owner.auth, eventId, [image]), upload(admin.auth, eventId, [image])]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.eventPhoto.count({ where: { eventId } })).toBe(1);
    expect(storage.uploads - storage.removed.length).toBe(1);
    expect(storage.removedWith.every((r) => r.access === 'authenticated')).toBe(true);
  });
});

describe('File validation and processing on the client upload path', () => {
  it('checks the real content: wrong MIME type, fake signature and corrupted image are rejected (415)', async () => {
    const html = await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', Buffer.from('<script>x</script>'), { filename: 'x.html', contentType: 'text/html' });
    expect(html.status).toBe(415);
    const fake = await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', Buffer.from('not really a png file'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(415);
    const corrupted = Buffer.concat([PNG_BUFFER.subarray(0, 16), Buffer.alloc(64, 0xab)]);
    const broken = await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', corrupted, { filename: 'x.png', contentType: 'image/png' });
    expect(broken.status).toBe(415);
    expect(broken.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(storage.uploads).toBe(0);
  });

  it('rejects files larger than 5MB (413)', async () => {
    const big = Buffer.concat([PNG_BUFFER, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('removes metadata (EXIF / GPS) before the file reaches storage', async () => {
    const input = await jpegWithExif('Phone');
    expect((await sharp(input).metadata()).exif).toBeDefined();
    await upload(owner.auth, eventId, [input], 'image/jpeg').expect(201);
    const stored = storage.files[0].buffer;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(SECRET)).toBe(false);
  });
});

describe('Failures (storage and database)', () => {
  it('Cloudinary fails on the 2nd file → 502, the 1st file is removed, nothing saved', async () => {
    storage.failUploadAt = 2;
    const res = await upload(owner.auth, eventId, [await png(1), await png(2)]);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPLOAD_FAILED');
    expect(storage.removedWith).toEqual([{ publicId: `events/${eventId}/private-1`, access: 'authenticated' }]);
    expect(await prisma.eventPhoto.count()).toBe(0);
  });

  it('database fails after upload → 500 without internals, uploaded files are removed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('connection to server lost: secret-host:5432'));
    const res = await upload(owner.auth, eventId, [await png(1), await png(2)]);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret-host');
    expect(storage.removed.sort()).toEqual([`events/${eventId}/private-1`, `events/${eventId}/private-2`]);
    expect(await prisma.eventPhoto.count()).toBe(0);
  });

  it('storage not configured: upload 503; lists still work (url=null); single photo link 503', async () => {
    const [photo] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setImageStorage(new DisabledStorage());
    const up = await upload(owner.auth, eventId, [await png(2)]);
    expect(up.status).toBe(503);
    const details = await api.get(`/api/events/${eventId}`).set('Authorization', owner.auth);
    expect(details.status).toBe(200);
    expect(details.body.photos[0]).toMatchObject({ id: photo.id, url: null, urlExpiresAt: null });
    const single = await api.get(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', owner.auth);
    expect(single.status).toBe(503);
    expect(single.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('a storage failure while deleting does not fail the request (best effort)', async () => {
    const [photo] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failRemove = true;
    await api.delete(`/api/events/${eventId}/photos/${photo.id}`).set('Authorization', owner.auth).expect(204);
    expect(await prisma.eventPhoto.count()).toBe(0);
  });

  it('deleting an event removes its private and legacy public files, each with its own storage type', async () => {
    const [photo] = (await upload(owner.auth, eventId, [PNG_BUFFER])).body;
    const privateId = (await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photo.id } })).publicId;
    await prisma.eventPhoto.create({ data: { eventId, url: 'https://cdn.test/legacy.png', publicId: 'legacy-1' } });
    await api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removedWith).toEqual(
      expect.arrayContaining([
        { publicId: privateId, access: 'authenticated' },
        { publicId: 'legacy-1', access: 'public' },
      ]),
    );
    expect(await prisma.eventPhoto.count()).toBe(0);
  });
});

describe('Backward compatibility – legacy public photos', () => {
  it('legacy public photos keep their permanent URL (no expiry); clients never get publicId', async () => {
    const legacy = await prisma.eventPhoto.create({ data: { eventId, url: 'https://cdn.test/legacy.png', publicId: 'legacy-1' } });
    expect(legacy).toMatchObject({ storageType: 'public', publishConsent: false, uploadedById: null, contentHash: null });

    const asOwner = await api.get(`/api/events/${eventId}`).set('Authorization', owner.auth);
    expect(asOwner.body.photos[0]).toEqual({
      id: legacy.id,
      eventId,
      url: 'https://cdn.test/legacy.png',
      urlExpiresAt: null,
      isPrivate: false,
      publishConsent: false,
      publishedInGallery: false,
      uploadedByMe: false,
      canDelete: false,
      createdAt: legacy.createdAt.toISOString(),
    });
    const asAdmin = await api.get(`/api/events/${eventId}`).set('Authorization', admin.auth);
    expect(asAdmin.body.photos[0]).toMatchObject({ url: 'https://cdn.test/legacy.png', publicId: 'legacy-1', storageType: 'public', canDelete: true });
  });

  it('several legacy photos without a hash do not conflict with each other', async () => {
    await prisma.eventPhoto.createMany({ data: [1, 2, 3].map((i) => ({ eventId, url: `https://cdn.test/${i}.png`, publicId: null })) });
    await upload(owner.auth, eventId, [PNG_BUFFER]).expect(201);
    expect(await prisma.eventPhoto.count({ where: { eventId } })).toBe(4);
  });
});
