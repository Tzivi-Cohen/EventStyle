import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createAdmin, createUser, eventBody, prisma, resetDatabase } from './helpers';

type Auth = { auth: string; user: { id: number } };
let admin: Auth;
let client: Auth;

beforeEach(async () => {
  await resetDatabase(); // יוצר את 3 החבילות הכלליות: 1 Basic, 2 Premium, 3 Luxury
  admin = await createAdmin();
  client = await createUser({ email: 'client@test.com' });
});
afterAll(() => prisma.$disconnect());

function packageBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Birthday Classic',
    description: 'Sweets table and balloons',
    price: 1500,
    features: ['Sweets table', 'Balloon arch'],
    imageUrl: 'https://img.test/birthday.jpg',
    eventType: 'Birthday',
    ...overrides,
  };
}

async function createPackage(overrides: Record<string, unknown> = {}) {
  const res = await api.post('/api/packages').set('Authorization', admin.auth).send(packageBody(overrides));
  expect(res.status).toBe(201);
  return res.body as { id: number; name: string; eventType: string | null; price: number; isActive: boolean };
}

function createEvent(overrides: Record<string, unknown> = {}) {
  return api.post('/api/events').set('Authorization', admin.auth).send(eventBody(overrides));
}

describe('Public price list – GET /api/packages', () => {
  it('is public and returns the active packages with numeric prices and the new fields', async () => {
    const res = await api.get('/api/packages');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Basic', 'Premium', 'Luxury']);
    expect(res.body[0]).toEqual({
      id: 1,
      name: 'Basic',
      description: 'Basic package',
      price: 1200,
      features: ['Table'],
      imageUrl: 'https://img.test/basic.jpg',
      eventType: null,
      sortOrder: 0,
    });
    expect(res.body[0]).not.toHaveProperty('isActive');
  });

  it('filters by event type: that type first (by sortOrder, then price), then the general packages', async () => {
    await createPackage({ name: 'Birthday Deluxe', price: 3000, sortOrder: 1 });
    await createPackage({ name: 'Birthday Classic', price: 1500, sortOrder: 1 });
    await createPackage({ name: 'Birthday Mini', price: 9000, sortOrder: 0 });
    await createPackage({ name: 'Bat Mitzvah Gold', eventType: 'BatMitzvah' });

    const res = await api.get('/api/packages?eventType=Birthday');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual([
      'Birthday Mini',
      'Birthday Classic',
      'Birthday Deluxe',
      'Basic',
      'Premium',
      'Luxury',
    ]);
  });

  it('without a filter returns packages of every type and the general ones', async () => {
    await createPackage({ name: 'Bat Mitzvah Gold', eventType: 'BatMitzvah' });
    const res = await api.get('/api/packages');
    expect(res.body).toHaveLength(4);
  });

  it('rejects an unknown event type (400)', async () => {
    const res = await api.get('/api/packages?eventType=Wedding');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('archived packages are not shown', async () => {
    await api.delete('/api/packages/2').set('Authorization', admin.auth).expect(204);
    const res = await api.get('/api/packages');
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Basic', 'Luxury']);
  });
});

describe('Permissions', () => {
  const adminOnly = [
    ['GET /api/admin/packages', () => api.get('/api/admin/packages')],
    ['POST /api/packages', () => api.post('/api/packages').send(packageBody())],
    ['PUT /api/packages/1', () => api.put('/api/packages/1').send(packageBody())],
    ['DELETE /api/packages/1', () => api.delete('/api/packages/1')],
  ] as const;

  it.each(adminOnly)('%s: guest gets 401', async (_name, request) => {
    const res = await request();
    expect(res.status).toBe(401);
  });

  it.each(adminOnly)('%s: client gets 403', async (_name, request) => {
    const res = await request().set('Authorization', client.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('nothing changes after rejected requests', async () => {
    const before = await prisma.package.findMany({ orderBy: { id: 'asc' } });
    await api.put('/api/packages/1').set('Authorization', client.auth).send(packageBody({ price: 1 }));
    await api.delete('/api/packages/1').set('Authorization', client.auth);
    await api.post('/api/packages').send(packageBody());
    expect(await prisma.package.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
});

describe('Admin – create, edit, prices', () => {
  it('creates a package (active by default) and returns the admin view', async () => {
    const res = await api.post('/api/packages').set('Authorization', admin.auth).send(packageBody({ price: 1499.9 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Birthday Classic',
      eventType: 'Birthday',
      price: 1499.9,
      isActive: true,
      sortOrder: 0,
      eventCount: 0,
    });
    expect(res.body.createdAt).toEqual(expect.any(String));
  });

  it('creates a general package with eventType null', async () => {
    const pkg = await createPackage({ name: 'Gold', eventType: null });
    expect(pkg.eventType).toBeNull();
  });

  it('updates the price and details (PUT) – shown in the public price list', async () => {
    const pkg = await createPackage();
    const res = await api
      .put(`/api/packages/${pkg.id}`)
      .set('Authorization', admin.auth)
      .send(packageBody({ price: 1750.5, description: 'Updated description', features: ['A', 'B', 'C'] }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ price: 1750.5, description: 'Updated description', features: ['A', 'B', 'C'] });

    const list = await api.get('/api/packages?eventType=Birthday');
    expect(list.body.find((p: { id: number }) => p.id === pkg.id).price).toBe(1750.5);
  });

  it('changes the display order (sortOrder)', async () => {
    const a = await createPackage({ name: 'First', sortOrder: 0 });
    await createPackage({ name: 'Second', sortOrder: 1 });
    await api.put(`/api/packages/${a.id}`).set('Authorization', admin.auth).send(packageBody({ name: 'First', sortOrder: 5 })).expect(200);
    const list = await api.get('/api/packages?eventType=Birthday');
    expect(list.body.slice(0, 2).map((p: { name: string }) => p.name)).toEqual(['Second', 'First']);
  });

  it('PUT without isActive / sortOrder keeps their current values', async () => {
    const pkg = await createPackage({ sortOrder: 7 });
    await api.delete(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).expect(204);
    const res = await api.put(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).send(packageBody({ price: 1600 }));
    expect(res.body).toMatchObject({ isActive: false, sortOrder: 7, price: 1600 });
  });

  it.each([
    ['negative price', { price: -1 }, 'price'],
    ['3 decimal places', { price: 10.555 }, 'price'],
    ['price as a string', { price: '1500' }, 'price'],
    ['short name', { name: 'A' }, 'name'],
    ['name over 50 chars', { name: 'x'.repeat(51) }, 'name'],
    ['description over 500 chars', { description: 'x'.repeat(501) }, 'description'],
    ['no features', { features: [] }, 'features'],
    ['21 features', { features: Array.from({ length: 21 }, (_, i) => `f${i}`) }, 'features'],
    ['empty feature', { features: [' '] }, 'features.0'],
    ['http image URL', { imageUrl: 'http://img.test/a.jpg' }, 'imageUrl'],
    ['unknown event type', { eventType: 'Wedding' }, 'eventType'],
    ['missing eventType', { eventType: undefined }, 'eventType'],
    ['negative sortOrder', { sortOrder: -1 }, 'sortOrder'],
    ['fractional sortOrder', { sortOrder: 1.5 }, 'sortOrder'],
    ['isActive as a string', { isActive: 'yes' }, 'isActive'],
  ])('rejects %s (400)', async (_name, overrides, field) => {
    const res = await api.post('/api/packages').set('Authorization', admin.auth).send(packageBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects unknown fields such as id or eventCount (400)', async () => {
    const res = await api.post('/api/packages').set('Authorization', admin.auth).send({ ...packageBody(), id: 99 });
    expect(res.status).toBe(400);
  });

  it('a duplicate name in the same event type returns 409; the same name in another type is allowed', async () => {
    await createPackage({ name: 'Classic' });
    const dup = await api.post('/api/packages').set('Authorization', admin.auth).send(packageBody({ name: 'Classic' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('A package with this name already exists for this event type');
    await createPackage({ name: 'Classic', eventType: 'BatMitzvah' });
  });

  it('a duplicate name among the general packages returns 409 (partial unique index)', async () => {
    const res = await api.post('/api/packages').set('Authorization', admin.auth).send(packageBody({ name: 'Basic', eventType: null }));
    expect(res.status).toBe(409);
    // אותו שם כחבילה של סוג מסוים – מותר
    await createPackage({ name: 'Basic', eventType: 'Birthday' });
  });

  it('renaming to an existing name returns 409 and changes nothing', async () => {
    const pkg = await createPackage({ name: 'One' });
    await createPackage({ name: 'Two' });
    const res = await api.put(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).send(packageBody({ name: 'Two' }));
    expect(res.status).toBe(409);
    expect((await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).name).toBe('One');
  });

  it('PUT / DELETE on a missing package returns 404; an invalid id returns 400', async () => {
    await api.put('/api/packages/999').set('Authorization', admin.auth).send(packageBody()).expect(404);
    await api.delete('/api/packages/999').set('Authorization', admin.auth).expect(404);
    await api.delete('/api/packages/abc').set('Authorization', admin.auth).expect(400);
  });
});

describe('Admin list – GET /api/admin/packages', () => {
  it('includes archived packages, isActive and how many events use each package', async () => {
    await createEvent({ packageId: 1 }).expect(201);
    await createEvent({ packageId: 1 }).expect(201);
    await api.delete('/api/packages/3').set('Authorization', admin.auth).expect(204);

    const res = await api.get('/api/admin/packages').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.map((p: { name: string }) => [p.name, p]));
    expect(byName.Basic).toMatchObject({ isActive: true, eventCount: 2 });
    expect(byName.Luxury).toMatchObject({ isActive: false, eventCount: 0 });
  });

  it('filters by eventType (including "general") and by isActive', async () => {
    await createPackage({ name: 'B1' });
    await createPackage({ name: 'M1', eventType: 'BatMitzvah' });
    await api.delete('/api/packages/2').set('Authorization', admin.auth).expect(204);

    const names = async (query: string) =>
      (await api.get(`/api/admin/packages${query}`).set('Authorization', admin.auth)).body.map((p: { name: string }) => p.name);
    expect(await names('?eventType=Birthday')).toEqual(['B1']);
    expect(await names('?eventType=general')).toEqual(['Basic', 'Premium', 'Luxury']);
    expect(await names('?isActive=false')).toEqual(['Premium']);
    expect(await names('?eventType=general&isActive=true')).toEqual(['Basic', 'Luxury']);
    await api.get('/api/admin/packages?isActive=maybe').set('Authorization', admin.auth).expect(400);
  });
});

describe('Archive and restore', () => {
  it('DELETE archives (no physical delete) – hidden from the public list, still visible to the admin', async () => {
    const pkg = await createPackage();
    await api.delete(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).expect(204);

    const stored = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.isActive).toBe(false);
    const pub = await api.get('/api/packages?eventType=Birthday');
    expect(pub.body.map((p: { id: number }) => p.id)).not.toContain(pkg.id);
  });

  it('archiving twice is harmless (204)', async () => {
    await api.delete('/api/packages/1').set('Authorization', admin.auth).expect(204);
    await api.delete('/api/packages/1').set('Authorization', admin.auth).expect(204);
  });

  it('restores from the archive with PUT isActive=true', async () => {
    const pkg = await createPackage();
    await api.delete(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).expect(204);
    const res = await api.put(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).send(packageBody({ isActive: true }));
    expect(res.body.isActive).toBe(true);
    const pub = await api.get('/api/packages?eventType=Birthday');
    expect(pub.body.map((p: { id: number }) => p.id)).toContain(pkg.id);
  });

  it('existing events keep their archived package (name shown, budget unchanged)', async () => {
    const created = await createEvent({ packageId: 2, budget: 4321 });
    await api.delete('/api/packages/2').set('Authorization', admin.auth).expect(204);

    const res = await api.get(`/api/events/${created.body.id}`).set('Authorization', admin.auth);
    expect(res.body).toMatchObject({ packageId: 2, package: { id: 2, name: 'Premium' }, budget: 4321 });
  });

  it('an archived package cannot be selected for a new event (400)', async () => {
    await api.delete('/api/packages/2').set('Authorization', admin.auth).expect(204);
    const res = await createEvent({ packageId: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'packageId', message: 'Package is archived and cannot be selected' }]);
  });

  it('an existing event with an archived package can still be edited, but cannot switch TO an archived package', async () => {
    const onArchived = await createEvent({ packageId: 2 });
    const other = await createEvent({ packageId: 1 });
    await api.delete('/api/packages/2').set('Authorization', admin.auth).expect(204);

    const edit = await api
      .put(`/api/events/${onArchived.body.id}`)
      .set('Authorization', admin.auth)
      .send(eventBody({ packageId: 2, eventName: 'Edited name' }));
    expect(edit.status).toBe(200);
    expect(edit.body.eventName).toBe('Edited name');

    const switchTo = await api.put(`/api/events/${other.body.id}`).set('Authorization', admin.auth).send(eventBody({ packageId: 2 }));
    expect(switchTo.status).toBe(400);
  });
});

describe('Prices never change existing events', () => {
  it('changing a package price does not change budget or package of existing events', async () => {
    const created = await createEvent({ packageId: 1, budget: 3000 });
    const before = await prisma.event.findUniqueOrThrow({ where: { id: created.body.id } });

    await api
      .put('/api/packages/1')
      .set('Authorization', admin.auth)
      .send(packageBody({ name: 'Basic', eventType: null, price: 9999 }))
      .expect(200);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after).toEqual(before);
    const res = await api.get(`/api/events/${created.body.id}`).set('Authorization', admin.auth);
    expect(res.body.budget).toBe(3000);
    expect(res.body.package).toEqual({ id: 1, name: 'Basic' }); // מחיר החבילה לא מוחזר בהזמנה
  });
});

describe('Matching packages to event types', () => {
  it('a package of the event type or a general package can be used', async () => {
    const birthday = await createPackage();
    await createEvent({ eventType: 'Birthday', packageId: birthday.id }).expect(201);
    await createEvent({ eventType: 'Corporate', packageId: 1 }).expect(201); // כללית
  });

  it('a package of another type is rejected (400) when creating an event', async () => {
    const birthday = await createPackage();
    const res = await createEvent({ eventType: 'BatMitzvah', packageId: birthday.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { field: 'packageId', message: 'Package is for Birthday events and does not match eventType BatMitzvah' },
    ]);
  });

  it('changing only the event type of an event to a mismatching type is rejected', async () => {
    const birthday = await createPackage();
    const created = await createEvent({ eventType: 'Birthday', packageId: birthday.id });
    const res = await api
      .put(`/api/events/${created.body.id}`)
      .set('Authorization', admin.auth)
      .send(eventBody({ eventType: 'Corporate', packageId: birthday.id }));
    expect(res.status).toBe(400);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: created.body.id } })).eventType).toBe('Birthday');
  });

  it('a package used by events cannot change to a type that would mismatch them (409)', async () => {
    await createEvent({ eventType: 'Birthday', packageId: 1 }).expect(201);
    await createEvent({ eventType: 'Corporate', packageId: 1 }).expect(201);

    const res = await api
      .put('/api/packages/1')
      .set('Authorization', admin.auth)
      .send(packageBody({ name: 'Basic', eventType: 'Birthday' }));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ conflictingEvents: 1 });
    expect((await prisma.package.findUniqueOrThrow({ where: { id: 1 } })).eventType).toBeNull();
  });

  it('a package can change to the type that all its events already have', async () => {
    await createEvent({ eventType: 'Birthday', packageId: 1 }).expect(201);
    const res = await api
      .put('/api/packages/1')
      .set('Authorization', admin.auth)
      .send(packageBody({ name: 'Basic', eventType: 'Birthday' }));
    expect(res.status).toBe(200);
    expect(res.body.eventType).toBe('Birthday');
  });

  it('a package can always become general (null), even with events of several types', async () => {
    const birthday = await createPackage();
    await createEvent({ eventType: 'Birthday', packageId: birthday.id }).expect(201);
    const res = await api.put(`/api/packages/${birthday.id}`).set('Authorization', admin.auth).send(packageBody({ eventType: null }));
    expect(res.status).toBe(200);
    expect(res.body.eventType).toBeNull();
  });

  it('a package without events can change type freely', async () => {
    const pkg = await createPackage();
    const res = await api.put(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).send(packageBody({ eventType: 'Brit' }));
    expect(res.status).toBe(200);
    expect(res.body.eventType).toBe('Brit');
  });
});

describe('Concurrent requests', () => {
  it('changing a package type while events are created never leaves a mismatch', async () => {
    const pkg = await createPackage({ eventType: null, name: 'Shared' });
    const results = await Promise.all([
      createEvent({ eventType: 'Corporate', packageId: pkg.id }),
      api.put(`/api/packages/${pkg.id}`).set('Authorization', admin.auth).send(packageBody({ name: 'Shared', eventType: 'Birthday' })),
      createEvent({ eventType: 'Brit', packageId: pkg.id }),
    ]);
    for (const res of results) expect(res.status).toBeLessThan(500);

    const stored = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id }, include: { events: true } });
    if (stored.eventType !== null) {
      for (const event of stored.events) expect(event.eventType).toBe(stored.eventType);
    }
  });

  it('archiving while events are created: no new event points to an archived package after the archive', async () => {
    const pkg = await createPackage({ eventType: null, name: 'Racing' });
    const [first, archive, second] = await Promise.all([
      createEvent({ packageId: pkg.id }),
      api.delete(`/api/packages/${pkg.id}`).set('Authorization', admin.auth),
      createEvent({ packageId: pkg.id }),
    ]);
    expect(archive.status).toBe(204);
    for (const res of [first, second]) expect([201, 400]).toContain(res.status);
    expect((await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).isActive).toBe(false);
  });

  it('two concurrent creations with the same name create exactly one package', async () => {
    const results = await Promise.all([1, 2, 3].map(() => api.post('/api/packages').set('Authorization', admin.auth).send(packageBody({ name: 'Twin' }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const res of results) expect([201, 409]).toContain(res.status);
    expect(await prisma.package.count({ where: { name: 'Twin', eventType: 'Birthday' } })).toBe(1);
  });
});

describe('Database constraints', () => {
  it('rejects a negative sortOrder and a blank name even outside the API', async () => {
    await expect(prisma.package.update({ where: { id: 1 }, data: { sortOrder: -1 } })).rejects.toThrow();
    await expect(prisma.package.update({ where: { id: 1 }, data: { name: '   ' } })).rejects.toThrow();
  });

  it('a package with events cannot be physically deleted (FK RESTRICT)', async () => {
    await createEvent({ packageId: 1 }).expect(201);
    await expect(prisma.package.delete({ where: { id: 1 } })).rejects.toThrow();
  });
});
