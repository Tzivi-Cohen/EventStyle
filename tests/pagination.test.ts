import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createAdmin, createUser, prisma, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

type Page<T> = { data: T[]; pagination: { page: number; limit: number; totalItems: number; totalPages: number } };
type EventRow = { id: number; budget: number; status: string };

/** יוצר count אירועים ישירות במסד. תאריך זהה לכולם כדי לבדוק את יציבות המיון */
async function seedEvents(count: number, overrides: (i: number) => Record<string, unknown> = () => ({})) {
  await prisma.event.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      eventName: `Event ${i + 1}`,
      clientName: `Client ${i + 1}`,
      clientEmail: `client${i + 1}@test.com`,
      eventType: 'Birthday' as const,
      eventDate: new Date('2026-12-01T00:00:00.000Z'),
      location: 'Tel Aviv',
      packageId: 1,
      themeColor: '#fff',
      guestCount: 10,
      budget: 1000,
      ...overrides(i),
    })),
  });
}

describe('GET /api/events – pagination', () => {
  it('uses page=1 and limit=10 by default and returns totals', async () => {
    const admin = await createAdmin();
    await seedEvents(25);
    const res = await api.get('/api/events').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination).toEqual({ page: 1, limit: 10, totalItems: 25, totalPages: 3 });
  });

  it('returns the last partial page and an empty page after the end', async () => {
    const admin = await createAdmin();
    await seedEvents(25);
    const last = await api.get('/api/events?page=3').set('Authorization', admin.auth);
    expect(last.body.data).toHaveLength(5);
    const after = await api.get('/api/events?page=4').set('Authorization', admin.auth);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual([]);
    expect(after.body.pagination).toEqual({ page: 4, limit: 10, totalItems: 25, totalPages: 3 });
  });

  it('handles no results', async () => {
    const admin = await createAdmin();
    const res = await api.get('/api/events?search=nothing-matches').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 0 } });
  });

  it.each([
    'page=0',
    'page=-1',
    'page=abc',
    'page=1.5',
    'limit=0',
    'limit=101',
    'limit=abc',
    'limit=2.5',
    'page=',
    'limit=',
  ])('rejects invalid value %s with 400', async (query) => {
    const admin = await createAdmin();
    const res = await api.get(`/api/events?${query}`).set('Authorization', admin.auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts the maximum limit of 100', async () => {
    const admin = await createAdmin();
    await seedEvents(3);
    const res = await api.get('/api/events?limit=100').set('Authorization', admin.auth);
    expect(res.body.pagination).toMatchObject({ limit: 100, totalPages: 1 });
  });

  it('stable order: walking all pages returns every event exactly once (even with equal sort values)', async () => {
    const admin = await createAdmin();
    await seedEvents(23); // אותו תאריך ואותו תקציב לכולם
    const all = (await api.get('/api/events?limit=100&sortBy=budget').set('Authorization', admin.auth)).body as Page<EventRow>;

    const walked: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await api.get(`/api/events?limit=7&page=${page}&sortBy=budget`).set('Authorization', admin.auth);
      walked.push(...(res.body as Page<EventRow>).data.map((e) => e.id));
    }
    expect(walked).toHaveLength(23);
    expect(new Set(walked).size).toBe(23);
    expect(walked).toEqual(all.data.map((e) => e.id));
  });

  it('combines pagination with filtering and sorting', async () => {
    const admin = await createAdmin();
    await seedEvents(30, (i) => ({ status: i % 3 === 0 ? 'Ready' : 'New', budget: 100 * (i + 1) }));
    // 10 אירועים בסטטוס Ready, ממוינים לפי תקציב עולה, 4 בעמוד
    const pages: Page<EventRow>[] = [];
    for (let page = 1; page <= 3; page++) {
      pages.push((await api.get(`/api/events?status=Ready&sortBy=budget&sortDir=asc&limit=4&page=${page}`).set('Authorization', admin.auth)).body);
    }
    expect(pages[0]!.pagination).toEqual({ page: 1, limit: 4, totalItems: 10, totalPages: 3 });
    expect(pages.map((p) => p.data.length)).toEqual([4, 4, 2]);
    const rows = pages.flatMap((p) => p.data);
    expect(rows.every((e) => e.status === 'Ready')).toBe(true);
    const budgets = rows.map((e) => e.budget);
    expect(budgets).toEqual([...budgets].sort((a, b) => a - b));

    const searched = await api.get('/api/events?search=Event%201&limit=5').set('Authorization', admin.auth);
    // Event 1, Event 10..19 = 11 תוצאות
    expect(searched.body.pagination).toEqual({ page: 1, limit: 5, totalItems: 11, totalPages: 3 });
  });
});

describe('GET /api/events/my – pagination', () => {
  it('paginates only the logged-in client events', async () => {
    const client = await createUser({ email: 'noa@test.com' });
    const other = await createUser({ email: 'other@test.com' });
    await seedEvents(12, () => ({ userId: client.user.id, clientEmail: 'noa@test.com' }));
    await seedEvents(4, () => ({ userId: other.user.id, clientEmail: 'other@test.com' }));

    const res = await api.get('/api/events/my?limit=5&page=3').set('Authorization', client.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ page: 3, limit: 5, totalItems: 12, totalPages: 3 });
    expect(res.body.data.every((e: { userId: number }) => e.userId === client.user.id)).toBe(true);
    expect(res.body.data[0]).not.toHaveProperty('notes');

    await api.get('/api/events/my?limit=500').set('Authorization', client.auth).expect(400);
  });

  it('returns an empty page for a client without events', async () => {
    const client = await createUser({ email: 'noa@test.com' });
    const res = await api.get('/api/events/my').set('Authorization', client.auth);
    expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 0 } });
  });
});

describe('GET /api/gallery – pagination', () => {
  beforeEach(async () => {
    await prisma.galleryItem.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        title: `Design ${i + 1}`,
        category: i < 5 ? ('Brit' as const) : ('Birthday' as const),
        url: `https://img.test/${i + 1}.jpg`,
        createdAt: new Date('2026-10-01T10:00:00.000Z'), // אותו זמן לכולם – בודק את המיון המשני לפי id
      })),
    });
  });

  it('paginates with default and custom limits (public, no token)', async () => {
    const first = await api.get('/api/gallery');
    expect(first.body.data).toHaveLength(10);
    expect(first.body.pagination).toEqual({ page: 1, limit: 10, totalItems: 15, totalPages: 2 });
    const second = await api.get('/api/gallery?page=2');
    expect(second.body.data).toHaveLength(5);

    const ids = [...first.body.data, ...second.body.data].map((g: { id: number }) => g.id);
    expect(new Set(ids).size).toBe(15);

    const featured = await api.get('/api/gallery?limit=6');
    expect(featured.body.data).toHaveLength(6);
  });

  it('combines pagination with the category filter', async () => {
    const res = await api.get('/api/gallery?category=Brit&limit=2&page=3');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ page: 3, limit: 2, totalItems: 5, totalPages: 3 });
    await api.get('/api/gallery?limit=1000').expect(400);
  });
});
