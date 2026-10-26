import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventType } from '@prisma/client';
import { api, createAdmin, createUser, PNG_BUFFER, prisma, resetDatabase, storage } from './helpers';

type Auth = { auth: string; user: { id: number } };
let admin: Auth;
let client: Auth;

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
  client = await createUser({ email: 'client@test.com' });
});
afterAll(() => prisma.$disconnect());

let seq = 0;
/** פריט גלריה ישירות במסד (בלי העלאה), עם createdAt עולה כדי שהסדר יהיה צפוי */
async function item(category: EventType, data: { title?: string; isPublished?: boolean; isFeatured?: boolean; sortOrder?: number; publicId?: string | null } = {}) {
  seq += 1;
  return prisma.galleryItem.create({
    data: {
      title: data.title ?? `${category} ${seq}`,
      category,
      url: `https://img.test/${seq}.jpg`,
      publicId: data.publicId === undefined ? `gallery/${seq}` : data.publicId,
      isPublished: data.isPublished ?? true,
      isFeatured: data.isFeatured ?? false,
      sortOrder: data.sortOrder ?? 0,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    },
  });
}

const titles = (body: { data: { title: string }[] }) => body.data.map((i) => i.title);

describe('Public gallery – GET /api/gallery', () => {
  it('shows only published items, with the new fields, without isPublished', async () => {
    await item('Birthday', { title: 'Visible' });
    await item('Birthday', { title: 'Hidden', isPublished: false });

    const res = await api.get('/api/gallery');
    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(['Visible']);
    expect(res.body.pagination.totalItems).toBe(1);
    expect(res.body.data[0]).toMatchObject({ title: 'Visible', category: 'Birthday', isFeatured: false, sortOrder: 0 });
    expect(res.body.data[0]).not.toHaveProperty('isPublished');
  });

  it('a hidden item never appears – not by category, not as featured, not on any page', async () => {
    await item('Brit', { title: 'Hidden featured', isPublished: false, isFeatured: true });
    for (const query of ['', '?category=Brit', '?featured=true', '?category=Brit&featured=true', '?limit=100']) {
      const res = await api.get(`/api/gallery${query}`);
      expect(titles(res.body)).not.toContain('Hidden featured');
    }
  });

  it('filters by category and by featured', async () => {
    await item('Birthday', { title: 'B1' });
    await item('Birthday', { title: 'B2', isFeatured: true });
    await item('Corporate', { title: 'C1', isFeatured: true });

    expect(titles((await api.get('/api/gallery?category=Birthday')).body)).toEqual(['B2', 'B1']);
    expect(titles((await api.get('/api/gallery?featured=true')).body)).toEqual(['C1', 'B2']);
    expect(titles((await api.get('/api/gallery?featured=false')).body)).toEqual(['B1']);
    expect(titles((await api.get('/api/gallery?category=Birthday&featured=true')).body)).toEqual(['B2']);
  });

  it('orders by sortOrder, then newest first (the old order when every sortOrder is 0)', async () => {
    await item('Birthday', { title: 'Old' });
    await item('Birthday', { title: 'New' });
    expect(titles((await api.get('/api/gallery')).body)).toEqual(['New', 'Old']);

    await item('Birthday', { title: 'Pinned last', sortOrder: 9 });
    await item('Birthday', { title: 'Pinned first', sortOrder: 0 });
    expect(titles((await api.get('/api/gallery')).body)).toEqual(['Pinned first', 'New', 'Old', 'Pinned last']);
  });

  it('rejects invalid filters (400)', async () => {
    await api.get('/api/gallery?featured=yes').expect(400);
    await api.get('/api/gallery?category=Wedding').expect(400);
  });
});

describe('Public summary – GET /api/gallery/summary', () => {
  it('returns every event type, counting only published items, with an empty type at 0 and no cover', async () => {
    await item('Birthday', { title: 'B1' });
    await item('Birthday', { title: 'B2' });
    await item('Birthday', { title: 'Hidden', isPublished: false });
    await item('Brit', { title: 'Only hidden', isPublished: false });

    const res = await api.get('/api/gallery/summary');
    expect(res.status).toBe(200);
    expect(res.body.map((s: { category: string }) => s.category)).toEqual(['Birthday', 'BatMitzvah', 'Brit', 'Corporate', 'Private']);
    const byType = Object.fromEntries(res.body.map((s: { category: string }) => [s.category, s]));
    expect(byType.Birthday.count).toBe(2);
    expect(byType.Birthday.cover.title).toBe('B2'); // אין מובילה – הראשונה לפי הסדר
    expect(byType.Brit).toEqual({ category: 'Brit', count: 0, cover: null }); // רק מוסתרת – נחשבת ריקה
    expect(byType.Corporate).toEqual({ category: 'Corporate', count: 0, cover: null });
  });

  it('prefers a featured item as the cover, and never a hidden one', async () => {
    await item('Private', { title: 'First by order', sortOrder: 0 });
    await item('Private', { title: 'Featured', isFeatured: true, sortOrder: 5 });
    await item('Private', { title: 'Hidden featured', isFeatured: true, isPublished: false });

    const res = await api.get('/api/gallery/summary');
    const priv = res.body.find((s: { category: string }) => s.category === 'Private');
    expect(priv.count).toBe(2);
    expect(priv.cover.title).toBe('Featured');
    expect(priv.cover).not.toHaveProperty('isPublished');
  });
});

describe('Admin list – GET /api/admin/gallery', () => {
  it('includes hidden items, with isPublished and updatedAt, and supports filters', async () => {
    await item('Birthday', { title: 'Visible' });
    await item('Birthday', { title: 'Hidden', isPublished: false });
    await item('Corporate', { title: 'Star', isFeatured: true });

    const all = await api.get('/api/admin/gallery').set('Authorization', admin.auth);
    expect(all.status).toBe(200);
    expect(all.body.pagination.totalItems).toBe(3);
    expect(all.body.data.find((i: { title: string }) => i.title === 'Hidden')).toMatchObject({ isPublished: false, updatedAt: expect.any(String) });

    const get = async (query: string) => titles((await api.get(`/api/admin/gallery${query}`).set('Authorization', admin.auth)).body);
    expect(await get('?isPublished=false')).toEqual(['Hidden']);
    expect(await get('?isFeatured=true')).toEqual(['Star']);
    expect(await get('?category=Birthday&isPublished=true')).toEqual(['Visible']);
    await api.get('/api/admin/gallery?isPublished=1').set('Authorization', admin.auth).expect(400);
  });
});

describe('Admin edit – PATCH /api/gallery/:id', () => {
  it('edits title and category', async () => {
    const it1 = await item('Birthday', { title: 'Old title' });
    const res = await api.patch(`/api/gallery/${it1.id}`).set('Authorization', admin.auth).send({ title: '  New title  ', category: 'Corporate' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: it1.id, title: 'New title', category: 'Corporate', isPublished: true });
    expect(titles((await api.get('/api/gallery?category=Corporate')).body)).toEqual(['New title']);
    expect(titles((await api.get('/api/gallery?category=Birthday')).body)).toEqual([]);
  });

  it('hides and publishes again', async () => {
    const it1 = await item('Brit', { title: 'Toggle' });
    await api.patch(`/api/gallery/${it1.id}`).set('Authorization', admin.auth).send({ isPublished: false }).expect(200);
    expect(titles((await api.get('/api/gallery')).body)).toEqual([]);
    expect((await api.get('/api/gallery/summary')).body.find((s: { category: string }) => s.category === 'Brit').count).toBe(0);

    await api.patch(`/api/gallery/${it1.id}`).set('Authorization', admin.auth).send({ isPublished: true }).expect(200);
    expect(titles((await api.get('/api/gallery')).body)).toEqual(['Toggle']);
  });

  it('marks a featured item and sets the order', async () => {
    const a = await item('Birthday', { title: 'A' });
    await item('Birthday', { title: 'B' });
    await api.patch(`/api/gallery/${a.id}`).set('Authorization', admin.auth).send({ isFeatured: true, sortOrder: 7 }).expect(200);
    expect(titles((await api.get('/api/gallery?featured=true')).body)).toEqual(['A']);
    expect(titles((await api.get('/api/gallery')).body)).toEqual(['B', 'A']);
  });

  it('changes only the fields that were sent; the image itself does not change', async () => {
    const it1 = await item('Birthday', { title: 'Keep', isFeatured: true, sortOrder: 3 });
    await api.patch(`/api/gallery/${it1.id}`).set('Authorization', admin.auth).send({ title: 'Renamed' }).expect(200);
    const after = await prisma.galleryItem.findUniqueOrThrow({ where: { id: it1.id } });
    expect(after).toMatchObject({ title: 'Renamed', category: 'Birthday', isFeatured: true, sortOrder: 3, url: it1.url, publicId: it1.publicId });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(it1.updatedAt.getTime());
  });

  it.each([
    ['empty body', {}],
    ['short title', { title: 'A' }],
    ['unknown category', { category: 'Wedding' }],
    ['isPublished as a string', { isPublished: 'true' }],
    ['negative sortOrder', { sortOrder: -1 }],
    ['sortOrder over 1000', { sortOrder: 1001 }],
    ['unknown field url', { url: 'https://evil.test/x.jpg' }],
    ['unknown field publicId', { publicId: 'x' }],
  ])('rejects %s (400) and changes nothing', async (_name, body) => {
    const it1 = await item('Birthday', { title: 'Stable' });
    const res = await api.patch(`/api/gallery/${it1.id}`).set('Authorization', admin.auth).send(body);
    expect(res.status).toBe(400);
    expect(await prisma.galleryItem.findUniqueOrThrow({ where: { id: it1.id } })).toEqual(it1);
  });

  it('returns 404 for a missing item and 400 for an invalid id', async () => {
    await api.patch('/api/gallery/999').set('Authorization', admin.auth).send({ title: 'Nope' }).expect(404);
    await api.patch('/api/gallery/abc').set('Authorization', admin.auth).send({ title: 'Nope' }).expect(400);
  });
});

describe('Permissions – only the admin manages the gallery', () => {
  it('guest gets 401 and client gets 403 on PATCH, DELETE, POST and the admin list – and nothing changes', async () => {
    const it1 = await item('Birthday', { title: 'Protected' });
    const requests = [
      () => api.patch(`/api/gallery/${it1.id}`).send({ isPublished: false }),
      () => api.delete(`/api/gallery/${it1.id}`),
      () => api.post('/api/gallery').field('title', 'X title').field('category', 'Birthday').attach('image', PNG_BUFFER, 'a.png'),
      () => api.get('/api/admin/gallery'),
    ];
    for (const request of requests) {
      expect((await request()).status).toBe(401);
      const res = await request().set('Authorization', client.auth);
      expect(res.status).toBe(403);
    }
    expect(await prisma.galleryItem.findUniqueOrThrow({ where: { id: it1.id } })).toEqual(it1);
    expect(await prisma.galleryItem.count()).toBe(1);
    expect(storage.uploads).toBe(0);
  });

  it('the public endpoints need no login', async () => {
    await api.get('/api/gallery').expect(200);
    await api.get('/api/gallery/summary').expect(200);
  });
});

describe('Upload and delete', () => {
  it('uploads with the new optional fields (multipart strings)', async () => {
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Draft photo')
      .field('category', 'BatMitzvah')
      .field('isPublished', 'false')
      .field('isFeatured', 'true')
      .field('sortOrder', '4')
      .attach('image', PNG_BUFFER, 'draft.png');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Draft photo', isPublished: false, isFeatured: true, sortOrder: 4 });
    expect(titles((await api.get('/api/gallery')).body)).not.toContain('Draft photo'); // לא פורסמה
  });

  it('upload defaults: published, not featured, sortOrder 0', async () => {
    const res = await api.post('/api/gallery').set('Authorization', admin.auth).field('title', 'Default').field('category', 'Brit').attach('image', PNG_BUFFER, 'd.png');
    expect(res.body).toMatchObject({ isPublished: true, isFeatured: false, sortOrder: 0 });
  });

  it.each([
    ['isPublished', 'yes'],
    ['sortOrder', '-1'],
    ['sortOrder', '1.5'],
  ])('rejects invalid multipart field %s=%s (400) and uploads nothing', async (field, value) => {
    const res = await api
      .post('/api/gallery')
      .set('Authorization', admin.auth)
      .field('title', 'Bad')
      .field('category', 'Brit')
      .field(field, value)
      .attach('image', PNG_BUFFER, 'b.png');
    expect(res.status).toBe(400);
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('deleting one item removes only its own file and keeps every other item', async () => {
    const keepA = await item('Birthday', { title: 'Keep A' });
    const remove = await item('Birthday', { title: 'Remove' });
    const keepB = await item('Corporate', { title: 'Keep B' });

    await api.delete(`/api/gallery/${remove.id}`).set('Authorization', admin.auth).expect(204);

    expect(storage.removed).toEqual([remove.publicId]);
    expect(await prisma.galleryItem.findUnique({ where: { id: keepA.id } })).toEqual(keepA);
    expect(await prisma.galleryItem.findUnique({ where: { id: keepB.id } })).toEqual(keepB);
  });

  it('hiding (PATCH) never deletes the file from storage', async () => {
    const it1 = await item('Birthday', { title: 'Hide me' });
    await api.patch(`/api/gallery/${it1.id}`).set('Authorization', admin.auth).send({ isPublished: false }).expect(200);
    expect(storage.removed).toEqual([]);
  });

  it('deleting an item without a Cloudinary file (external demo image) does not call storage removal', async () => {
    const external = await item('Private', { title: 'Picsum', publicId: null });
    await api.delete(`/api/gallery/${external.id}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removed).toEqual([]);
  });
});

describe('Database constraints', () => {
  it('rejects a negative sortOrder and a blank title even outside the API', async () => {
    const it1 = await item('Birthday');
    await expect(prisma.galleryItem.update({ where: { id: it1.id }, data: { sortOrder: -1 } })).rejects.toThrow();
    await expect(prisma.galleryItem.update({ where: { id: it1.id }, data: { title: '  ' } })).rejects.toThrow();
  });
});
