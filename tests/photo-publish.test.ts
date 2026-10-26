import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG_BUFFER, api, createAdmin, createUser, eventBody, prisma, resetDatabase, storage } from './helpers';

/** הסכמה לפרסום ופרסום בגלריה: עותק ציבורי נפרד, ביטול הסכמה, בקשות מקבילות וכשלים חלקיים */

type Auth = { auth: string; user: { id: number } };
let admin: Auth;
let owner: Auth;
let other: Auth;
let eventId: number;
let photoId: number;
let privatePublicId: string;

const png = (seed: number) =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: { r: seed, g: 255 - seed, b: 100 } } }).png().toBuffer();

const consent = (auth: string, value: unknown, id = photoId, event = eventId) =>
  api.put(`/api/events/${event}/photos/${id}/consent`).set('Authorization', auth).send({ publishConsent: value });
const publish = (body: Record<string, unknown> = { title: 'Pink birthday table' }, id = photoId, event = eventId) =>
  api.post(`/api/events/${event}/photos/${id}/publish`).set('Authorization', admin.auth).send(body);
const publicTitles = async () => (await api.get('/api/gallery')).body.data.map((i: { title: string }) => i.title);

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
  owner = await createUser({ email: 'owner@test.com' });
  other = await createUser({ email: 'other@test.com' });
  eventId = (await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'owner@test.com', eventType: 'Birthday' }))).body.id;
  const up = await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', PNG_BUFFER, 'p.png');
  photoId = up.body[0].id;
  privatePublicId = (await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).publicId!;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('Publish consent (event owner only)', () => {
  it('is false by default; a private photo is never published automatically', async () => {
    const photo = await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } });
    expect(photo.publishConsent).toBe(false);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(await publicTitles()).toEqual([]);
  });

  it('the owner gives and revokes consent', async () => {
    const given = await consent(owner.auth, true);
    expect(given.status).toBe(200);
    expect(given.body).toMatchObject({ id: photoId, publishConsent: true, publishedInGallery: false });
    expect(given.body).not.toHaveProperty('publicId');
    await consent(owner.auth, true).expect(200); // חוזר על עצמו בבטחה

    const revoked = await consent(owner.auth, false);
    expect(revoked.body.publishConsent).toBe(false);
    expect((await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).publishConsent).toBe(false);
  });

  it('the owner can consent for a photo the admin uploaded to her event', async () => {
    const up = await api.post(`/api/events/${eventId}/photos`).set('Authorization', admin.auth).attach('photos', await png(10), 'a.png');
    await consent(owner.auth, true, up.body[0].id).expect(200);
  });

  it('admin, another client and guests cannot change the consent', async () => {
    const byAdmin = await consent(admin.auth, true);
    expect(byAdmin.status).toBe(403);
    expect(byAdmin.body.error.message).toMatch(/Only the event owner/);
    await consent(other.auth, true).expect(403);
    await api.put(`/api/events/${eventId}/photos/${photoId}/consent`).send({ publishConsent: true }).expect(401);
    expect((await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).publishConsent).toBe(false);
  });

  it.each([
    ['missing field', {}],
    ['string instead of boolean', { publishConsent: 'true' }],
    ['unknown field', { publishConsent: true, storageType: 'public' }],
  ])('rejects an invalid body: %s (400)', async (_name, body) => {
    const res = await api.put(`/api/events/${eventId}/photos/${photoId}/consent`).set('Authorization', owner.auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Publishing to the gallery (admin only)', () => {
  it('without consent → 409 PUBLISH_CONSENT_REQUIRED, nothing is copied', async () => {
    const res = await publish();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PUBLISH_CONSENT_REQUIRED');
    expect(storage.copies).toHaveLength(0);
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('with consent: a separate public copy is created and linked to the source photo', async () => {
    await consent(owner.auth, true);
    const res = await publish();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Pink birthday table',
      category: 'Birthday', // ברירת מחדל: סוג האירוע
      isPublished: true,
      isFeatured: false,
      sortOrder: 0,
      sourceEventPhotoId: photoId,
      url: expect.stringMatching(/^https:\/\/cdn\.test\/gallery\/copy-/),
    });
    // העותק נוצר מהקובץ הפרטי – והמקור נשאר פרטי ולא השתנה
    expect(storage.copies).toEqual([{ access: 'authenticated', publicId: privatePublicId, format: 'png' }]);
    expect(res.body.publicId).not.toBe(privatePublicId);
    expect(await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ storageType: 'authenticated', publicId: privatePublicId });

    const gallery = await api.get('/api/gallery');
    expect(gallery.body.data).toHaveLength(1);
    expect(gallery.body.data[0]).not.toHaveProperty('sourceEventPhotoId'); // הקישור לאירוע הפרטי לא ציבורי

    const asOwner = await api.get(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', owner.auth);
    expect(asOwner.body.publishedInGallery).toBe(true);
    const asAdmin = await api.get(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', admin.auth);
    expect(asAdmin.body.galleryItemId).toBe(res.body.id);
  });

  it('supports title, category, hidden draft, featured and sort order; validates the body', async () => {
    await consent(owner.auth, true);
    const res = await publish({ title: 'Draft', category: 'Private', isPublished: false, isFeatured: true, sortOrder: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ category: 'Private', isPublished: false, isFeatured: true, sortOrder: 5 });
    expect(await publicTitles()).toEqual([]);

    await publish({}).expect(400);
    await publish({ title: 'X', url: 'https://evil.test/a.png' }).expect(400);
    await publish({ title: 'Valid', category: 'Wedding' }).expect(400);
  });

  it('client and guest cannot publish (403 / 401)', async () => {
    await consent(owner.auth, true);
    await api.post(`/api/events/${eventId}/photos/${photoId}/publish`).set('Authorization', owner.auth).send({ title: 'Mine' }).expect(403);
    await api.post(`/api/events/${eventId}/photos/${photoId}/publish`).send({ title: 'Mine' }).expect(401);
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('wrong event/photo combination → 404', async () => {
    await consent(owner.auth, true);
    const otherEvent = (await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'other@test.com' }))).body.id;
    await publish({ title: 'Nope' }, photoId, otherEvent).expect(404);
    await publish({ title: 'Nope' }, 99999).expect(404);
  });

  it('publishing twice → 409 ALREADY_PUBLISHED, only one copy', async () => {
    await consent(owner.auth, true);
    const first = await publish();
    const second = await publish();
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: 'ALREADY_PUBLISHED', details: { galleryItemId: first.body.id } });
    expect(storage.copies).toHaveLength(1);
  });

  it('parallel publish requests create exactly one gallery item; extra copies are removed', async () => {
    await consent(owner.auth, true);
    const results = await Promise.all([publish(), publish(), publish()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.galleryItem.count()).toBe(1);
    expect(storage.copies.length - storage.removed.length).toBe(1);
  });

  it('a legacy public photo is published as a separate copy too', async () => {
    const legacy = await prisma.eventPhoto.create({ data: { eventId, url: 'https://cdn.test/legacy.png', publicId: 'legacy-1', publishConsent: true } });
    const res = await publish({ title: 'Legacy' }, legacy.id);
    expect(res.status).toBe(201);
    expect(storage.copies).toEqual([{ access: 'public', url: 'https://cdn.test/legacy.png' }]);
    expect(res.body.publicId).not.toBe('legacy-1');
  });
});

describe('Revoking consent removes the public copy', () => {
  async function published() {
    await consent(owner.auth, true);
    return (await publish()).body as { id: number; publicId: string };
  }

  it('revoking deletes the gallery item and the public file (with CDN invalidation)', async () => {
    const item = await published();
    const res = await consent(owner.auth, false);
    expect(res.body).toMatchObject({ publishConsent: false, publishedInGallery: false });
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(storage.removedWith).toEqual([{ publicId: item.publicId, access: 'public' }]);
    expect(await publicTitles()).toEqual([]);
    // הקובץ הפרטי המקורי לא נמחק
    expect(storage.removed).not.toContain(privatePublicId);
    await publish().expect(409); // אין הסכמה – אין פרסום מחדש
  });

  it('if storage fails, the copy is hidden at once, cannot be re-published, and a repeated revoke cleans it up', async () => {
    const item = await published();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failRemove = true;
    await consent(owner.auth, false).expect(200);
    const pending = await prisma.galleryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(pending.isPublished).toBe(false);
    expect(await publicTitles()).toEqual([]);

    const republish = await api.patch(`/api/gallery/${item.id}`).set('Authorization', admin.auth).send({ isPublished: true });
    expect(republish.status).toBe(409);
    expect(republish.body.error.code).toBe('PUBLISH_CONSENT_REQUIRED');
    // שאר העריכות עדיין מותרות
    await api.patch(`/api/gallery/${item.id}`).set('Authorization', admin.auth).send({ title: 'Renamed' }).expect(200);

    storage.failRemove = false;
    await consent(owner.auth, false).expect(200);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(storage.removedWith).toEqual([{ publicId: item.publicId, access: 'public' }]);
  });

  it('revoke racing with publish never leaves a public copy behind', async () => {
    await consent(owner.auth, true);
    await Promise.all([publish(), consent(owner.auth, false)]);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(storage.copies.length).toBe(storage.removed.length);
    expect(await publicTitles()).toEqual([]);
  });
});

describe('Partial failures while publishing', () => {
  it('copy fails in Cloudinary → 502, no gallery item', async () => {
    await consent(owner.auth, true);
    storage.failCopy = true;
    const res = await publish();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPLOAD_FAILED');
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('database fails after the copy → 500, the public copy is removed', async () => {
    await consent(owner.auth, true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('db down'));
    const res = await publish();
    expect(res.status).toBe(500);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(storage.removedWith).toEqual([{ publicId: 'gallery/copy-2', access: 'public' }]);
  });
});

describe('Deleting a published source removes its public copy first', () => {
  /** תמונה נוספת עם הסכמה ופרסום; מחזיר את מזהה התמונה ואת העותק */
  async function publishedPhoto(seed?: number) {
    let id = photoId;
    if (seed !== undefined) {
      id = (await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', await png(seed), `s${seed}.png`)).body[0].id;
    }
    await consent(owner.auth, true, id);
    const copy = (await publish({ title: `Copy ${seed ?? 0}` }, id)).body as { id: number; publicId: string };
    return { id, copy };
  }
  const privateIdOf = async (id: number) => (await prisma.eventPhoto.findUniqueOrThrow({ where: { id } })).publicId!;

  it.each(['owner', 'admin'] as const)('%s deletes a published photo: the copy is removed (public, invalidate) before the private source', async (who) => {
    const { copy } = await publishedPhoto();
    const auth = who === 'owner' ? owner.auth : admin.auth;
    await api.delete(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', auth).expect(204);
    expect(storage.removedWith).toEqual([
      { publicId: copy.publicId, access: 'public' },
      { publicId: privatePublicId, access: 'authenticated' },
    ]);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(await prisma.eventPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(await publicTitles()).toEqual([]);
  });

  it('existing permissions are unchanged: a client cannot delete an admin-uploaded published photo', async () => {
    const byAdmin = (await api.post(`/api/events/${eventId}/photos`).set('Authorization', admin.auth).attach('photos', await png(20), 'a.png')).body[0];
    await consent(owner.auth, true, byAdmin.id);
    await publish({ title: 'Admin photo' }, byAdmin.id).expect(201);
    await api.delete(`/api/events/${eventId}/photos/${byAdmin.id}`).set('Authorization', owner.auth).expect(403);
    await api.delete(`/api/events/${eventId}/photos/${byAdmin.id}`).set('Authorization', other.auth).expect(403);
    // שום דבר לא השתנה: העותק עדיין מפורסם וההסכמה בתוקף
    expect(await publicTitles()).toEqual(['Admin photo']);
    expect((await prisma.eventPhoto.findUniqueOrThrow({ where: { id: byAdmin.id } })).publishConsent).toBe(true);
    expect(storage.removed).toEqual([]);
  });

  it('storage failure: 502, the source is kept, the copy stays hidden and cannot be re-published; a retry finishes the job', async () => {
    const { copy } = await publishedPhoto();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failRemoveIds.add(copy.publicId);

    const res = await api.delete(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', owner.auth);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'STORAGE_DELETE_FAILED', details: { galleryItemIds: [copy.id] } });
    // המידע לניקוי חוזר נשמר: הפריט, ה-publicId והקישור למקור
    expect(await prisma.galleryItem.findUniqueOrThrow({ where: { id: copy.id } })).toMatchObject({ isPublished: false, publicId: copy.publicId, sourceEventPhotoId: photoId });
    expect(await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ publishConsent: false });
    expect(await publicTitles()).toEqual([]);
    expect(storage.removed).not.toContain(privatePublicId); // המקור לא נמחק לפני העותק

    const republish = await api.patch(`/api/gallery/${copy.id}`).set('Authorization', admin.auth).send({ isPublished: true });
    expect(republish.body.error.code).toBe('PUBLISH_CONSENT_REQUIRED');
    expect((await publish()).body.error.code).toBe('PUBLISH_CONSENT_REQUIRED');

    storage.failRemoveIds.clear();
    await api.delete(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', owner.auth).expect(204);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(storage.removedWith).toEqual([
      { publicId: copy.publicId, access: 'public' },
      { publicId: privatePublicId, access: 'authenticated' },
    ]);
  });

  it('parallel deletions of the same published photo: one 204, the others 404; nothing is left behind', async () => {
    await publishedPhoto();
    const results = await Promise.all([1, 2, 3].map(() => api.delete(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', owner.auth)));
    expect(results.map((r) => r.status).sort()).toEqual([204, 404, 404]);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(await prisma.eventPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(await publicTitles()).toEqual([]);
  });

  it('deleting an event removes every photo, every linked copy, and leaves unrelated gallery items alone', async () => {
    const first = await publishedPhoto();
    const second = await publishedPhoto(30);
    const secondPrivate = await privateIdOf(second.id);
    const legacy = await prisma.galleryItem.create({ data: { title: 'Legacy item', category: 'Brit', url: 'https://img.test/l.jpg', publicId: 'legacy-gallery' } });
    const otherEvent = (await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'other@test.com' }))).body.id;
    await api.post(`/api/events/${otherEvent}/photos`).set('Authorization', other.auth).attach('photos', await png(40), 'o.png').expect(201);
    const otherPhoto = (await prisma.eventPhoto.findFirstOrThrow({ where: { eventId: otherEvent } })).id;
    await consent(other.auth, true, otherPhoto, otherEvent);
    const otherCopy = (await publish({ title: 'Other event copy' }, otherPhoto, otherEvent)).body;

    await api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removedWith).toEqual(
      expect.arrayContaining([
        { publicId: first.copy.publicId, access: 'public' },
        { publicId: second.copy.publicId, access: 'public' },
        { publicId: privatePublicId, access: 'authenticated' },
        { publicId: secondPrivate, access: 'authenticated' },
      ]),
    );
    expect(storage.removed).toHaveLength(4);
    expect((await prisma.galleryItem.findMany({ orderBy: { id: 'asc' } })).map((i) => i.id)).toEqual([legacy.id, otherCopy.id]);
    expect(await publicTitles()).toEqual(expect.arrayContaining(['Legacy item', 'Other event copy']));
    expect(await prisma.eventPhoto.count({ where: { eventId } })).toBe(0);
  });

  it('event deletion with a storage failure: 502, the event is kept, removed copies stay removed, a retry completes', async () => {
    const first = await publishedPhoto();
    const second = await publishedPhoto(31);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failRemoveIds.add(second.copy.publicId);

    const res = await api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'STORAGE_DELETE_FAILED', details: { galleryItemIds: [second.copy.id] } });
    expect(await prisma.event.count({ where: { id: eventId } })).toBe(1);
    expect(await prisma.galleryItem.count({ where: { id: first.copy.id } })).toBe(0);
    expect(await prisma.galleryItem.findUniqueOrThrow({ where: { id: second.copy.id } })).toMatchObject({ isPublished: false, sourceEventPhotoId: second.id });
    expect(await prisma.eventPhoto.count({ where: { eventId, publishConsent: true } })).toBe(0);
    expect(await publicTitles()).toEqual([]);
    expect(storage.removedWith.filter((r) => r.access === 'authenticated')).toEqual([]); // אף קובץ פרטי לא נמחק

    storage.failRemoveIds.clear();
    await api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth).expect(204);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(await prisma.event.count({ where: { id: eventId } })).toBe(0);
  });

  it('parallel event deletion and photo deletion end cleanly', async () => {
    await publishedPhoto();
    await publishedPhoto(32);
    const [ev, ph] = await Promise.all([
      api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth),
      api.delete(`/api/events/${eventId}/photos/${photoId}`).set('Authorization', owner.auth),
    ]);
    expect(ev.status).toBe(204);
    expect([204, 404]).toContain(ph.status);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(await prisma.event.count({ where: { id: eventId } })).toBe(0);
    expect(storage.copies.length).toBe(storage.removedWith.filter((r) => r.access === 'public').length);
  });

  it('event deletion racing with publish never leaves a public copy behind', async () => {
    await consent(owner.auth, true);
    const [, deleted] = await Promise.all([publish(), api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth)]);
    if (deleted.status !== 204) {
      // הפרסום נכנס בין השלבים – המחיקה נעצרה (409) בלי למחוק דבר; ניסיון חוזר מסיר הכול
      expect(deleted.status).toBe(409);
      expect(deleted.body.error.code).toBe('PHOTO_IN_GALLERY');
      await api.delete(`/api/events/${eventId}`).set('Authorization', admin.auth).expect(204);
    }
    expect(await prisma.event.count({ where: { id: eventId } })).toBe(0);
    expect(await prisma.galleryItem.count()).toBe(0);
    expect(storage.copies.length).toBe(storage.removedWith.filter((r) => r.access === 'public').length);
  });

  it('admin deletes only the copy (DELETE /gallery/:id): source and consent unchanged; storage failure → 502, item stays hidden', async () => {
    const { copy } = await publishedPhoto();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failRemoveIds.add(copy.publicId);
    const failed = await api.delete(`/api/gallery/${copy.id}`).set('Authorization', admin.auth);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('STORAGE_DELETE_FAILED');
    expect(await prisma.galleryItem.findUniqueOrThrow({ where: { id: copy.id } })).toMatchObject({ isPublished: false, publicId: copy.publicId });
    expect(await publicTitles()).toEqual([]);

    storage.failRemoveIds.clear();
    await api.delete(`/api/gallery/${copy.id}`).set('Authorization', admin.auth).expect(204);
    expect(storage.removedWith).toEqual([{ publicId: copy.publicId, access: 'public' }]);
    expect(await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ publishConsent: true, publicId: privatePublicId });
    await publish().expect(201); // אפשר לפרסם שוב
  });
});

describe('Admin list of event photos', () => {
  it('filters by consent and gallery state (photos waiting for publication)', async () => {
    const second = (await api.post(`/api/events/${eventId}/photos`).set('Authorization', owner.auth).attach('photos', await png(50), 'b.png')).body[0];
    await consent(owner.auth, true);

    const waiting = await api.get('/api/admin/event-photos?publishConsent=true&inGallery=false').set('Authorization', admin.auth);
    expect(waiting.status).toBe(200);
    expect(waiting.body.pagination).toMatchObject({ page: 1, totalItems: 1 });
    expect(waiting.body.data[0]).toMatchObject({
      id: photoId,
      publishConsent: true,
      galleryItemId: null,
      url: expect.stringMatching(/^https:\/\/private\.test\//),
      event: { id: eventId, eventName: 'Birthday Party', eventType: 'Birthday', clientName: 'Noa Levi' },
    });

    await publish();
    const inGallery = await api.get('/api/admin/event-photos?inGallery=true').set('Authorization', admin.auth);
    expect(inGallery.body.data.map((p: { id: number }) => p.id)).toEqual([photoId]);
    const byEvent = await api.get(`/api/admin/event-photos?eventId=${eventId}`).set('Authorization', admin.auth);
    expect(byEvent.body.data.map((p: { id: number }) => p.id)).toEqual([second.id, photoId]); // החדשות קודם
  });

  it('is admin only and validates the query', async () => {
    await api.get('/api/admin/event-photos').set('Authorization', owner.auth).expect(403);
    await api.get('/api/admin/event-photos?publishConsent=yes').set('Authorization', admin.auth).expect(400);
    await api.get('/api/admin/event-photos?eventId=abc').set('Authorization', admin.auth).expect(400);
  });
});

describe('Backward compatibility – gallery items without a source photo', () => {
  it('legacy items keep working (edit, hide, re-publish, delete) and show sourceEventPhotoId=null to the admin', async () => {
    const legacy = await prisma.galleryItem.create({ data: { title: 'Old item', category: 'Brit', url: 'https://img.test/old.jpg' } });
    await api.patch(`/api/gallery/${legacy.id}`).set('Authorization', admin.auth).send({ isPublished: false }).expect(200);
    const back = await api.patch(`/api/gallery/${legacy.id}`).set('Authorization', admin.auth).send({ isPublished: true });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ isPublished: true, sourceEventPhotoId: null });
    const adminList = await api.get('/api/admin/gallery').set('Authorization', admin.auth);
    expect(adminList.body.data[0]).toHaveProperty('sourceEventPhotoId', null);
    await api.delete(`/api/gallery/${legacy.id}`).set('Authorization', admin.auth).expect(204);
  });
});
