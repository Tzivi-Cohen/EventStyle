import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createAdmin, createUser, eventBody, prisma, resetDatabase } from './helpers';

type Auth = { auth: string; user: { id: number } };
let admin: Auth;
let clientA: Auth;
let clientB: Auth;

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
  clientA = await createUser({ email: 'a@test.com', fullName: 'Client A' });
  clientB = await createUser({ email: 'b@test.com', fullName: 'Client B' });
});
afterAll(() => prisma.$disconnect());

async function createEvent(overrides: Record<string, unknown> = {}) {
  const res = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody(overrides));
  expect(res.status).toBe(201);
  return res.body;
}

describe('Admin – create / edit / delete / status', () => {
  it('creates an event (default status New) linked to a verified client by email', async () => {
    const event = await createEvent({ clientEmail: ' A@Test.com ' });
    expect(event).toMatchObject({
      id: expect.any(Number),
      clientEmail: 'a@test.com',
      status: 'New',
      userId: clientA.user.id,
      eventDate: '2026-12-15',
      budget: 3000,
      notes: 'internal note',
      package: { id: 1, name: 'Basic' },
      photos: [],
    });
  });

  it('keeps userId null when no client with this email exists', async () => {
    const event = await createEvent({ clientEmail: 'new@test.com' });
    expect(event.userId).toBeNull();
  });

  it('rejects userId in the body – only the server sets it', async () => {
    const res = await api
      .post('/api/events')
      .set('Authorization', admin.auth)
      .send(eventBody({ userId: clientB.user.id }));
    expect(res.status).toBe(400);
  });

  it('edits an event (PUT) and re-links by the new email', async () => {
    const event = await createEvent({ clientEmail: 'a@test.com' });
    const res = await api
      .put(`/api/events/${event.id}`)
      .set('Authorization', admin.auth)
      .send(eventBody({ eventName: 'Updated name', clientEmail: 'b@test.com', budget: 4200.5, packageId: 3 }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      eventName: 'Updated name',
      userId: clientB.user.id,
      budget: 4200.5,
      packageId: 3,
      status: 'New',
    });
  });

  it('PUT without status keeps the current status', async () => {
    const event = await createEvent({ status: 'Ready' });
    const res = await api.put(`/api/events/${event.id}`).set('Authorization', admin.auth).send(eventBody());
    expect(res.body.status).toBe('Ready');
  });

  it('updates the status (PATCH)', async () => {
    const event = await createEvent();
    const res = await api
      .patch(`/api/events/${event.id}/status`)
      .set('Authorization', admin.auth)
      .send({ status: 'Preparing' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Preparing');
  });

  it('rejects an invalid status', async () => {
    const event = await createEvent();
    const res = await api
      .patch(`/api/events/${event.id}/status`)
      .set('Authorization', admin.auth)
      .send({ status: 'Done' });
    expect(res.status).toBe(400);
  });

  it('deletes an event (and its photos)', async () => {
    const event = await createEvent();
    await prisma.eventPhoto.create({ data: { eventId: event.id, url: 'https://cdn.test/x.png', publicId: 'x' } });

    await api.delete(`/api/events/${event.id}`).set('Authorization', admin.auth).expect(204);
    await api.get(`/api/events/${event.id}`).set('Authorization', admin.auth).expect(404);
    expect(await prisma.eventPhoto.count()).toBe(0);
  });

  it('returns 404 for a missing event and 400 for a bad id', async () => {
    await api.put('/api/events/9999').set('Authorization', admin.auth).send(eventBody()).expect(404);
    await api.patch('/api/events/9999/status').set('Authorization', admin.auth).send({ status: 'Ready' }).expect(404);
    await api.delete('/api/events/9999').set('Authorization', admin.auth).expect(404);
    await api.get('/api/events/abc').set('Authorization', admin.auth).expect(400);
  });
});

describe('Validation', () => {
  it.each([
    ['missing eventName', { eventName: undefined }, 'eventName'],
    ['invalid email', { clientEmail: 'bad' }, 'clientEmail'],
    ['unknown eventType', { eventType: 'Wedding' }, 'eventType'],
    ['invalid date', { eventDate: '2026-02-30' }, 'eventDate'],
    ['guestCount 0', { guestCount: 0 }, 'guestCount'],
    ['guestCount not integer', { guestCount: 10.5 }, 'guestCount'],
    ['negative budget', { budget: -1 }, 'budget'],
    ['budget as string', { budget: '100' }, 'budget'],
    ['bad cover URL', { coverImageUrl: 'javascript:alert(1)' }, 'coverImageUrl'],
    ['missing themeColor', { themeColor: '' }, 'themeColor'],
  ])('rejects %s', async (_name, overrides, field) => {
    const res = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects a packageId that does not exist', async () => {
    const res = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ packageId: 99 }));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('packageId');
  });

  it('database CHECK constraints protect data integrity too', async () => {
    await expect(
      prisma.event.create({
        data: { ...eventBody(), eventType: 'Birthday', eventDate: new Date('2026-12-15'), guestCount: 0 },
      }),
    ).rejects.toThrow();
  });
});

describe('Search, filter and sort (GET /api/events)', () => {
  beforeEach(async () => {
    await createEvent({ eventName: 'Maya Bat Mitzvah', clientName: 'Dana Cohen', eventType: 'BatMitzvah', status: 'Planning', packageId: 3, budget: 9000, eventDate: '2026-11-01' });
    await createEvent({ eventName: 'Company Launch', clientName: 'Tech Ltd', eventType: 'Corporate', status: 'Ready', packageId: 2, budget: 15000, eventDate: '2027-01-10' });
    await createEvent({ eventName: 'Omer Birthday', clientName: 'Avi Levi', eventType: 'Birthday', status: 'Planning', packageId: 1, budget: 800, eventDate: '2026-12-20' });
  });

  const names = (body: { data: { eventName: string }[] }) => body.data.map((e) => e.eventName);

  it('default sort: eventDate desc', async () => {
    const res = await api.get('/api/events').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['Company Launch', 'Omer Birthday', 'Maya Bat Mitzvah']);
    expect(res.body.data[0]).toHaveProperty('photoCount', 0);
  });

  it('searches by event name or client name (case-insensitive)', async () => {
    const byEvent = await api.get('/api/events?search=maya').set('Authorization', admin.auth);
    expect(names(byEvent.body)).toEqual(['Maya Bat Mitzvah']);
    const byClient = await api.get('/api/events?search=LEVI').set('Authorization', admin.auth);
    expect(names(byClient.body)).toEqual(['Omer Birthday']);
  });

  it('filters by eventType, status and packageId', async () => {
    const type = await api.get('/api/events?eventType=Corporate').set('Authorization', admin.auth);
    expect(names(type.body)).toEqual(['Company Launch']);
    const status = await api.get('/api/events?status=Planning').set('Authorization', admin.auth);
    expect(names(status.body).sort()).toEqual(['Maya Bat Mitzvah', 'Omer Birthday']);
    const pkg = await api.get('/api/events?packageId=3').set('Authorization', admin.auth);
    expect(names(pkg.body)).toEqual(['Maya Bat Mitzvah']);
    const combined = await api.get('/api/events?status=Planning&eventType=Birthday').set('Authorization', admin.auth);
    expect(names(combined.body)).toEqual(['Omer Birthday']);
  });

  it('sorts by budget and clientName', async () => {
    const budget = await api.get('/api/events?sortBy=budget&sortDir=asc').set('Authorization', admin.auth);
    expect(budget.body.data.map((e: { budget: number }) => e.budget)).toEqual([800, 9000, 15000]);
    const client = await api.get('/api/events?sortBy=clientName&sortDir=asc').set('Authorization', admin.auth);
    expect(client.body.data.map((e: { clientName: string }) => e.clientName)).toEqual(['Avi Levi', 'Dana Cohen', 'Tech Ltd']);
  });

  it('rejects invalid query parameters', async () => {
    await api.get('/api/events?sortBy=password').set('Authorization', admin.auth).expect(400);
    await api.get('/api/events?status=Unknown').set('Authorization', admin.auth).expect(400);
    await api.get('/api/events?sortDir=up').set('Authorization', admin.auth).expect(400);
  });
});

describe('Client permissions', () => {
  it('client cannot list all events, create, edit, delete or change status (403)', async () => {
    const event = await createEvent({ clientEmail: 'a@test.com' });
    await api.get('/api/events').set('Authorization', clientA.auth).expect(403);
    await api.post('/api/events').set('Authorization', clientA.auth).send(eventBody()).expect(403);
    await api.put(`/api/events/${event.id}`).set('Authorization', clientA.auth).send(eventBody()).expect(403);
    await api.patch(`/api/events/${event.id}/status`).set('Authorization', clientA.auth).send({ status: 'Ready' }).expect(403);
    await api.delete(`/api/events/${event.id}`).set('Authorization', clientA.auth).expect(403);
  });

  it('guest (no token) gets 401 on every events endpoint', async () => {
    await api.get('/api/events').expect(401);
    await api.get('/api/events/my').expect(401);
    await api.get('/api/events/1').expect(401);
    await api.post('/api/events').send(eventBody()).expect(401);
    await api.put('/api/events/1').send(eventBody()).expect(401);
    await api.patch('/api/events/1/status').send({ status: 'Ready' }).expect(401);
    await api.delete('/api/events/1').expect(401);
    await api.post('/api/events/1/photos').expect(401);
    await api.delete('/api/events/1/photos/1').expect(401);
  });

  it('client sees only own events in /my, without internal notes', async () => {
    await createEvent({ eventName: 'A event', clientEmail: 'a@test.com' });
    await createEvent({ eventName: 'B event', clientEmail: 'b@test.com' });

    const res = await api.get('/api/events/my').set('Authorization', clientA.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { eventName: string }) => e.eventName)).toEqual(['A event']);
    expect(res.body.data[0]).not.toHaveProperty('notes');
  });

  it('client can view own event details (status + photos) but not notes', async () => {
    const event = await createEvent({ clientEmail: 'a@test.com', status: 'Preparing' });
    await prisma.eventPhoto.create({ data: { eventId: event.id, url: 'https://cdn.test/1.png' } });

    const res = await api.get(`/api/events/${event.id}`).set('Authorization', clientA.auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Preparing');
    expect(res.body.photos).toHaveLength(1);
    expect(res.body).not.toHaveProperty('notes');
  });

  it("client cannot access another client's event (403)", async () => {
    const event = await createEvent({ clientEmail: 'b@test.com' });
    const res = await api.get(`/api/events/${event.id}`).set('Authorization', clientA.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admin sees notes on a single event', async () => {
    const event = await createEvent();
    const res = await api.get(`/api/events/${event.id}`).set('Authorization', admin.auth);
    expect(res.body.notes).toBe('internal note');
  });
});
