import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage, DisabledStorage, setImageStorage } from '../src/services/storage/imageStorage';
import sharp from 'sharp';
import { PNG_BUFFER, api, createAdmin, createUser, eventBody, prisma, resetDatabase, storage } from './helpers';

type Auth = { auth: string };
let admin: Auth;
let client: Auth;

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
  client = await createUser({ email: 'a@test.com' });
});
afterAll(() => prisma.$disconnect());

describe('Gallery', () => {
  beforeEach(async () => {
    await prisma.galleryItem.createMany({
      data: [
        { title: 'Pastel birthday', category: 'Birthday', url: 'https://img.test/1.jpg' },
        { title: 'Golden bat mitzvah', category: 'BatMitzvah', url: 'https://img.test/2.jpg' },
        { title: 'Blue brit', category: 'Brit', url: 'https://img.test/3.jpg' },
      ],
    });
  });

  it('is public and supports category filter and limit', async () => {
    const all = await api.get('/api/gallery');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(3);

    const filtered = await api.get('/api/gallery?category=Brit');
    expect(filtered.body.data.map((i: { title: string }) => i.title)).toEqual(['Blue brit']);

    const limited = await api.get('/api/gallery?limit=2');
    expect(limited.body.data).toHaveLength(2);

    await api.get('/api/gallery?category=Wedding').expect(400);
  });

  it('admin can add an image (multipart) and delete it', async () => {
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'New design')
      .field('category', 'Corporate')
      .attach('image', PNG_BUFFER, { filename: 'design.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'New design', category: 'Corporate', publicId: 'gallery/1' });

    await api.delete(`/api/gallery/${res.body.id}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removed).toContain('gallery/1');
    await api.delete(`/api/gallery/${res.body.id}`).set('Authorization', admin.auth).expect(404);
  });

  it('client gets 403 and guest gets 401 when managing the gallery', async () => {
    await api.post('/api/gallery').set('Authorization', client.auth).expect(403);
    await api.delete('/api/gallery/1').set('Authorization', client.auth).expect(403);
    await api.post('/api/gallery').expect(401);
    await api.delete('/api/gallery/1').expect(401);
  });

  it('requires an image and valid fields', async () => {
    const noFile = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'No file')
      .field('category', 'Birthday');
    expect(noFile.status).toBe(400);

    const badCategory = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Bad')
      .field('category', 'Wedding')
      .attach('image', PNG_BUFFER, { filename: 'x.png', contentType: 'image/png' });
    expect(badCategory.status).toBe(400);
    expect(storage.uploads).toBe(0);
  });
});

describe('Upload protection (type and size)', () => {
  it('rejects a non-image MIME type with 415', async () => {
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Script')
      .field('category', 'Birthday')
      .attach('image', Buffer.from('<script>alert(1)</script>'), { filename: 'x.html', contentType: 'text/html' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a fake image (wrong file signature) with 415', async () => {
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Fake')
      .field('category', 'Birthday')
      .attach('image', Buffer.from('this is not a png at all'), { filename: 'fake.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
  });

  it('rejects files larger than 5MB with 413', async () => {
    const big = Buffer.concat([PNG_BUFFER, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Big')
      .field('category', 'Birthday')
      .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('returns 503 when image storage is not configured', async () => {
    setImageStorage(new DisabledStorage());
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'No storage')
      .field('category', 'Birthday')
      .attach('image', PNG_BUFFER, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('returns 502 UPLOAD_FAILED when Cloudinary rejects the upload, and saves nothing', async () => {
    const spy = vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((
      _options: unknown,
      callback: (error: { message: string }) => void,
    ) => ({ end: () => callback({ message: 'cloud_name mismatch' }) })) as never);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    setImageStorage(new CloudinaryStorage());
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Cloud error')
      .field('category', 'Birthday')
      .attach('image', PNG_BUFFER, { filename: 'x.png', contentType: 'image/png' });
    spy.mockRestore();
    errorLog.mockRestore();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPLOAD_FAILED');
    expect(await prisma.galleryItem.count({ where: { title: 'Cloud error' } })).toBe(0);
  });
});

describe('Event photos', () => {
  async function createEvent(clientEmail = 'a@test.com') {
    const res = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail }));
    return res.body as { id: number };
  }

  it('admin uploads several photos; the owner client can see them', async () => {
    const event = await createEvent();
    const second = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } }).png().toBuffer();
    const res = await api
      .post(`/api/events/${event.id}/photos`)
      .set('Authorization', admin.auth)
      .attach('photos', PNG_BUFFER, { filename: '1.png', contentType: 'image/png' })
      .attach('photos', second, { filename: '2.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ eventId: event.id, url: expect.stringContaining('https://') });

    const view = await api.get(`/api/events/${event.id}`).set('Authorization', client.auth);
    expect(view.body.photos).toHaveLength(2);
  });

  it('admin deletes a photo; wrong event/photo combination returns 404', async () => {
    const event = await createEvent();
    const other = await createEvent('b@test.com');
    const upload = await api
      .post(`/api/events/${event.id}/photos`)
      .set('Authorization', admin.auth)
      .attach('photos', PNG_BUFFER, { filename: '1.png', contentType: 'image/png' });
    const photoId = upload.body[0].id;

    await api.delete(`/api/events/${other.id}/photos/${photoId}`).set('Authorization', admin.auth).expect(404);
    await api.delete(`/api/events/${event.id}/photos/${photoId}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removed).toContain(upload.body[0].publicId);
  });

  it('a client who does not own the event cannot upload or delete photos (403)', async () => {
    const event = await createEvent('b@test.com');
    await api
      .post(`/api/events/${event.id}/photos`)
      .set('Authorization', client.auth)
      .attach('photos', PNG_BUFFER, { filename: '1.png', contentType: 'image/png' })
      .expect(403);
    await api.delete(`/api/events/${event.id}/photos/1`).set('Authorization', client.auth).expect(403);
    expect(storage.uploads).toBe(0);
  });

  it('upload to a missing event returns 404, and no files returns 400', async () => {
    await api
      .post('/api/events/9999/photos')
      .set('Authorization', admin.auth)
      .attach('photos', PNG_BUFFER, { filename: '1.png', contentType: 'image/png' })
      .expect(404);
    const event = await createEvent();
    await api.post(`/api/events/${event.id}/photos`).set('Authorization', admin.auth).expect(400);
  });
});
