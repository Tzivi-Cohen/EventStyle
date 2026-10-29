import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createAdmin, createUser, eventBody, PNG_BUFFER, prisma, resetDatabase } from './helpers';

/** בקשות לקוחות לעיצוב אירוע: שליחה, עריכה (Pending בלבד), אישור ודחייה בידי המנהלת */

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  eventName: 'Shira Bat Mitzvah',
  eventType: 'BatMitzvah',
  eventDate: '2027-03-18',
  location: 'Raanana',
  packageId: 2,
  themeColor: 'Lavender',
  guestCount: 120,
  budget: 9000,
  description: 'Provence concept: lavender, natural wood and candles',
  clientNotes: 'The hall opens at 16:00',
  ...overrides,
});

type Session = Awaited<ReturnType<typeof createUser>>;
let admin: Session;
let client: Session;
let other: Session;

const sendRequest = (who: Session, overrides: Record<string, unknown> = {}) =>
  api.post('/api/events/requests').set('Authorization', who.auth).send(requestBody(overrides));
const editRequest = (who: Session, id: number, body: Record<string, unknown>) =>
  api.patch(`/api/events/${id}/request`).set('Authorization', who.auth).send(body);
const approve = (id: number) => api.post(`/api/events/${id}/approve`).set('Authorization', admin.auth);
const reject = (id: number, reason?: string) =>
  api.post(`/api/events/${id}/reject`).set('Authorization', admin.auth).send(reason === undefined ? {} : { reason });

beforeEach(async () => {
  await resetDatabase();
  admin = await createAdmin();
  client = await createUser({ email: 'noa@test.com', fullName: 'Noa Levi' });
  other = await createUser({ email: 'dana@test.com', fullName: 'Dana Cohen' });
});
afterAll(() => prisma.$disconnect());

describe('POST /api/events/requests – a client sends a request', () => {
  it('creates a Pending request owned by the client; name and email come from the account', async () => {
    const res = await sendRequest(client);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'Pending',
      userId: client.user.id,
      clientName: 'Noa Levi',
      clientEmail: 'noa@test.com',
      description: 'Provence concept: lavender, natural wood and candles',
      clientNotes: 'The hall opens at 16:00',
      reviewedAt: null,
      rejectionReason: null,
    });
    expect(res.body).not.toHaveProperty('notes');
    expect(res.body).not.toHaveProperty('reviewedById');
    expect(await prisma.event.count()).toBe(1);
  });

  it('rejects any field outside the allowlist (status, owner, email, internal notes)', async () => {
    for (const extra of [{ status: 'New' }, { userId: other.user.id }, { clientEmail: 'x@test.com' }, { notes: 'x' }, { coverImageUrl: 'https://x.test/a.jpg' }]) {
      const res = await sendRequest(client, extra);
      expect(res.status).toBe(400);
    }
    expect(await prisma.event.count()).toBe(0);
  });

  it('validates the fields: past date, missing description, package of another event type', async () => {
    expect((await sendRequest(client, { eventDate: '2020-01-01' })).status).toBe(400);
    expect((await sendRequest(client, { description: 'short' })).status).toBe(400);
    await prisma.package.update({ where: { id: 2 }, data: { eventType: 'Corporate' } });
    const wrongPackage = await sendRequest(client);
    expect(wrongPackage.status).toBe(400);
    expect(wrongPackage.body.error.details[0].field).toBe('packageId');
    expect(await prisma.event.count()).toBe(0);
  });

  it('any logged-in client can send a request, also without a verified email; an admin gets 403 and a guest 401', async () => {
    expect((await sendRequest(admin)).status).toBe(403);
    expect((await api.post('/api/events/requests').send(requestBody())).status).toBe(401);
    expect(await prisma.event.count()).toBe(0);

    const unverified = await createUser({ email: 'new@test.com', verified: false });
    const res = await sendRequest(unverified);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'Pending', userId: unverified.user.id, clientEmail: 'new@test.com' });
  });

  it('a freshly registered client (no code) sends a request right away', async () => {
    const reg = await api
      .post('/api/auth/register')
      .send({ fullName: 'Maya Cohen', email: 'maya@test.com', phone: '050-1234567', password: 'Secret123' })
      .expect(201);
    const res = await api.post('/api/events/requests').set('Authorization', `Bearer ${reg.body.token}`).send(requestBody());
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(reg.body.user.id);
  });

  it('admin-created events are NOT linked to an unproven (password) account with the same email', async () => {
    const reg = await api
      .post('/api/auth/register')
      .send({ fullName: 'Someone', email: 'shira@test.com', phone: '050-1234567', password: 'Secret123' })
      .expect(201);
    const created = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'shira@test.com' }));
    expect(created.status).toBe(201);
    expect(created.body.userId).toBeNull();

    const auth = `Bearer ${reg.body.token}`;
    expect((await api.get('/api/events/my').set('Authorization', auth)).body.data).toEqual([]);
    expect((await api.get(`/api/events/${created.body.id}`).set('Authorization', auth)).status).toBe(403);
  });

  it('the same request sent twice is rejected; other names or dates are legitimate new requests', async () => {
    expect((await sendRequest(client)).status).toBe(201);
    const again = await sendRequest(client, { eventName: '  shira BAT mitzvah ' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('You already have a request or an event with this name on this date');
    expect((await sendRequest(client, { eventDate: '2027-03-19' })).status).toBe(201);
    expect((await sendRequest(client, { eventName: 'Shira Birthday' })).status).toBe(201);
    // לקוחה אחרת עם אותו שם ותאריך – לא כפילות
    expect((await sendRequest(other)).status).toBe(201);
    expect(await prisma.event.count()).toBe(4);
  });

  it('a request that was already approved cannot be sent again by mistake', async () => {
    const { body } = await sendRequest(client);
    expect((await approve(body.id)).status).toBe(200);
    const again = await sendRequest(client);
    expect(again.status).toBe(409);
    expect(await prisma.event.count()).toBe(1);
  });

  it('a rejected request can be sent again', async () => {
    const { body } = await sendRequest(client);
    await reject(body.id);
    expect((await sendRequest(client)).status).toBe(201);
    expect(await prisma.event.count()).toBe(2);
  });

  it('parallel identical requests create exactly one', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => sendRequest(client)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.event.count()).toBe(1);
  });

  it('at most 5 pending requests per client – also when sent in parallel', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((i) => sendRequest(client, { eventName: `Request ${i}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const refused = results.filter((r) => r.status !== 201);
    for (const res of refused) {
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual({ limit: 5, current: 5 });
    }
    expect(await prisma.event.count({ where: { status: 'Pending' } })).toBe(5);
    // אחרי אישור אחת – מתפנה מקום
    const first = await prisma.event.findFirstOrThrow({ where: { status: 'Pending' } });
    await approve(first.id);
    expect((await sendRequest(client, { eventName: 'Request 8' })).status).toBe(201);
  });
});

describe('PATCH /api/events/:id/request – editing a pending request', () => {
  it('the owner edits allowed fields of a Pending request', async () => {
    const { body } = await sendRequest(client);
    const res = await editRequest(client, body.id, { guestCount: 140, clientNotes: null, location: 'Herzliya' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ guestCount: 140, clientNotes: null, location: 'Herzliya', status: 'Pending', eventName: 'Shira Bat Mitzvah' });
  });

  it('cannot change status, owner or admin data (400), and an empty body is rejected', async () => {
    const { body } = await sendRequest(client);
    for (const forbidden of [{ status: 'New' }, { userId: other.user.id }, { notes: 'x' }, { reviewedAt: new Date().toISOString() }, {}]) {
      expect((await editRequest(client, body.id, forbidden)).status).toBe(400);
    }
    expect((await prisma.event.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('Pending');
  });

  it('another client gets 403, a missing request 404, an admin 403 (admins approve / reject instead)', async () => {
    const { body } = await sendRequest(client);
    expect((await editRequest(other, body.id, { guestCount: 1 })).status).toBe(403);
    expect((await editRequest(client, 9999, { guestCount: 1 })).status).toBe(404);
    expect((await editRequest(admin, body.id, { guestCount: 1 })).status).toBe(403);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: body.id } })).guestCount).toBe(120);
  });

  it('an approved request is locked (409)', async () => {
    const { body } = await sendRequest(client);
    await approve(body.id);
    const res = await editRequest(client, body.id, { guestCount: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Only a pending request can be edited');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: body.id } })).guestCount).toBe(120);
  });

  it('a rejected request is locked (409)', async () => {
    const { body } = await sendRequest(client);
    await reject(body.id, 'Date taken');
    expect((await editRequest(client, body.id, { guestCount: 10 })).status).toBe(409);
  });

  it('an admin-created event cannot be edited through the request endpoint', async () => {
    const created = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ clientEmail: 'noa@test.com' }));
    expect(created.body.userId).toBe(client.user.id);
    expect((await editRequest(client, created.body.id, { guestCount: 1 })).status).toBe(409);
  });

  it('an edit cannot turn the request into a duplicate of another one', async () => {
    await sendRequest(client);
    const { body: second } = await sendRequest(client, { eventName: 'Other party' });
    expect((await editRequest(client, second.id, { eventName: 'SHIRA bat mitzvah' })).status).toBe(409);
  });

  it('an edit running together with an approval never changes an approved event', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { body } = await sendRequest(client, { eventName: `Race ${round}` });
      const [edit, approval] = await Promise.all([editRequest(client, body.id, { guestCount: 999 }), approve(body.id)]);
      expect(approval.status).toBe(200);
      const saved = await prisma.event.findUniqueOrThrow({ where: { id: body.id } });
      expect(saved.status).toBe('New');
      if (edit.status === 200) {
        // העריכה הסתיימה לפני האישור – המנהלת אישרה את הגרסה הערוכה
        expect(saved.guestCount).toBe(999);
      } else {
        expect(edit.status).toBe(409);
        expect(saved.guestCount).toBe(120);
      }
    }
  });
});

describe('Approve and reject (admin only)', () => {
  it('approve: Pending → New on the same record, with reviewer and time', async () => {
    const { body } = await sendRequest(client);
    const res = await approve(body.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: body.id, status: 'New', reviewedById: admin.user.id, rejectionReason: null });
    expect(res.body.reviewedAt).toEqual(expect.any(String));
    expect(await prisma.event.count()).toBe(1);
  });

  it('reject keeps the request in the database with the reason, visible to the client', async () => {
    const { body } = await sendRequest(client);
    expect((await reject(body.id, 'The date is taken')).status).toBe(200);
    const view = await api.get(`/api/events/${body.id}`).set('Authorization', client.auth);
    expect(view.body).toMatchObject({ status: 'Rejected', rejectionReason: 'The date is taken' });
    expect(await prisma.event.count()).toBe(1);
  });

  it('a client cannot approve or reject, not even her own request', async () => {
    const { body } = await sendRequest(client);
    expect((await api.post(`/api/events/${body.id}/approve`).set('Authorization', client.auth)).status).toBe(403);
    expect((await api.post(`/api/events/${body.id}/reject`).set('Authorization', client.auth).send({})).status).toBe(403);
    expect((await api.patch(`/api/events/${body.id}/status`).set('Authorization', client.auth).send({ status: 'New' })).status).toBe(403);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('Pending');
  });

  it('double approval, or approve + reject at the same time: exactly one decision wins', async () => {
    const { body } = await sendRequest(client);
    const results = await Promise.all([approve(body.id), approve(body.id), reject(body.id)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await prisma.event.count()).toBe(1);
    expect((await approve(body.id)).body.error.message).toBe('This request was already reviewed');
  });

  it('404 for a missing request; an operational event cannot be "approved" again', async () => {
    expect((await approve(9999)).status).toBe(404);
    const created = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody());
    expect((await approve(created.body.id)).status).toBe(409);
  });
});

describe('Status management after approval (admin)', () => {
  it('the admin moves freely between operational statuses (corrections allowed)', async () => {
    const { body } = await sendRequest(client);
    await approve(body.id);
    for (const status of ['Planning', 'Ready', 'Planning', 'Completed', 'Preparing']) {
      const res = await api.patch(`/api/events/${body.id}/status`).set('Authorization', admin.auth).send({ status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  it('Pending / Rejected cannot be set directly, and a request status cannot be changed with PATCH /status or PUT', async () => {
    const { body } = await sendRequest(client);
    const setPending = await api.post('/api/events').set('Authorization', admin.auth).send(eventBody({ status: 'Pending' }));
    expect(setPending.status).toBe(400);
    expect((await api.patch(`/api/events/${body.id}/status`).set('Authorization', admin.auth).send({ status: 'Rejected' })).status).toBe(400);
    const skipReview = await api.patch(`/api/events/${body.id}/status`).set('Authorization', admin.auth).send({ status: 'Planning' });
    expect(skipReview.status).toBe(409);
    const put = await api.put(`/api/events/${body.id}`).set('Authorization', admin.auth).send(eventBody({ clientEmail: 'noa@test.com' }));
    expect(put.status).toBe(409);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('Pending');
  });

  it('an admin edit after approval keeps the client description and notes when the form omits them', async () => {
    const { body } = await sendRequest(client);
    await approve(body.id);
    const res = await api.put(`/api/events/${body.id}`).set('Authorization', admin.auth).send(eventBody({ clientEmail: 'noa@test.com', guestCount: 130 }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ guestCount: 130, description: 'Provence concept: lavender, natural wood and candles', clientNotes: 'The hall opens at 16:00' });
  });
});

describe('Lists and photos', () => {
  it('GET /events/my: only own events and requests, with search, filters, budget range and sorting', async () => {
    await sendRequest(client, { eventName: 'Cheap party', budget: 1000 });
    const { body: mid } = await sendRequest(client, { eventName: 'Garden party', budget: 5000, eventType: 'Birthday' });
    await sendRequest(client, { eventName: 'Big wedding', budget: 20000 });
    await sendRequest(other, { eventName: 'Garden party of Dana', budget: 5000 });
    await approve(mid.id);

    const list = (query: string) => api.get(`/api/events/my${query}`).set('Authorization', client.auth);
    const names = (res: { body: { data: { eventName: string }[] } }) => res.body.data.map((e) => e.eventName);

    expect(names(await list('?sortBy=budget&sortDir=asc'))).toEqual(['Cheap party', 'Garden party', 'Big wedding']);
    expect(names(await list('?search=garden'))).toEqual(['Garden party']);
    expect(names(await list('?status=Pending&sortBy=eventName&sortDir=asc'))).toEqual(['Big wedding', 'Cheap party']);
    expect(names(await list('?eventType=Birthday'))).toEqual(['Garden party']);
    expect(names(await list('?minBudget=2000&maxBudget=10000'))).toEqual(['Garden party']);
    expect((await list('?minBudget=5000&maxBudget=100')).status).toBe(400);
    expect((await list('?sortBy=userId')).status).toBe(400);
  });

  it('GET /events (admin): budget range and request statuses', async () => {
    await sendRequest(client, { eventName: 'Party A', budget: 1000 });
    const { body } = await sendRequest(client, { eventName: 'Party B', budget: 3000 });
    await reject(body.id);
    const res = await api.get('/api/events?status=Rejected&minBudget=2000').set('Authorization', admin.auth);
    expect(res.body.data.map((e: { eventName: string }) => e.eventName)).toEqual(['Party B']);
    expect(res.body.data[0]).toHaveProperty('reviewedById', admin.user.id);
  });

  it('a client uploads photos only after the request is approved', async () => {
    const { body } = await sendRequest(client);
    const upload = () => api.post(`/api/events/${body.id}/photos`).set('Authorization', client.auth).attach('photos', PNG_BUFFER, 'a.png');
    const pending = await upload();
    expect(pending.status).toBe(409);
    expect(pending.body.error.message).toBe('Photos can be added only after the request is approved');
    await approve(body.id);
    expect((await upload()).status).toBe(201);
  });

  it('a client never sees another client request', async () => {
    const { body } = await sendRequest(other);
    expect((await api.get(`/api/events/${body.id}`).set('Authorization', client.auth)).status).toBe(403);
    expect((await api.get('/api/events/my').set('Authorization', client.auth)).body.data).toEqual([]);
  });
});
