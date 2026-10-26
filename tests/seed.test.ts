import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_TYPE_PACKAGES, seed, seedOptionsFromEnv, type SeedOptions } from '../prisma/seed';
import { signAccessToken } from '../src/auth/jwt';
import { api, prisma } from './helpers';

/** מסד ריק לגמרי (בלי החבילות שה-helpers יוצרים) – כמו הקמה ראשונה */
async function emptyDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "EventPhotos", "Events", "GalleryItems", "Users", "Packages" RESTART IDENTITY CASCADE',
  );
}

const quiet = { log: () => undefined };
const production: SeedOptions = {
  isProduction: true,
  adminEmail: 'owner@studio.test',
  adminPassword: 'Production-Secret-1',
  clientPassword: 'Client-Secret-1', // גם אם הוגדרה בטעות – לא נוצרים לקוחות ב-Production
  demoPackages: true, // גם אם הוגדר בטעות – לא נוצרות חבילות הדגמה ב-Production
  ...quiet,
};
const development: SeedOptions = {
  isProduction: false,
  adminEmail: 'admin@eventstyle.example',
  adminPassword: 'Admin12345',
  clientPassword: 'Client12345',
  demoPackages: true,
  ...quiet,
};

async function counts() {
  return {
    users: await prisma.user.count(),
    clients: await prisma.user.count({ where: { role: 'Client' } }),
    events: await prisma.event.count(),
    photos: await prisma.eventPhoto.count(),
    gallery: await prisma.galleryItem.count(),
    packages: await prisma.package.count(),
    typePackages: await prisma.package.count({ where: { eventType: { not: null } } }),
  };
}

beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

describe('Seed in Production', () => {
  it('creates only the general packages and the admin – no demo data at all', async () => {
    await seed(prisma, production);
    expect(await counts()).toEqual({ users: 1, clients: 0, events: 0, photos: 0, gallery: 0, packages: 3, typePackages: 0 });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@studio.test' } });
    expect(admin).toMatchObject({ role: 'Admin', emailVerified: true });
  });

  it('without SEED_ADMIN_PASSWORD no admin is created', async () => {
    await seed(prisma, { ...production, adminPassword: null });
    expect(await prisma.user.count()).toBe(0);
  });

  it('does not publish demo prices: the general packages are created archived and the public price list is empty', async () => {
    await seed(prisma, production);
    const packages = await prisma.package.findMany();
    expect(packages).toHaveLength(3);
    expect(packages.every((pkg) => !pkg.isActive && pkg.eventType === null)).toBe(true);

    const publicList = await api.get('/api/packages');
    expect(publicList.status).toBe(200);
    expect(publicList.body).toEqual([]);
  });

  it('the admin can set a real price and activate an archived package', async () => {
    await seed(prisma, production);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: production.adminEmail } });
    const auth = `Bearer ${signAccessToken(admin)}`;
    const basic = await prisma.package.findFirstOrThrow({ where: { name: 'Basic', eventType: null } });

    await api
      .put(`/api/packages/${basic.id}`)
      .set('Authorization', auth)
      .send({
        name: 'Basic', description: basic.description, price: 1650, features: basic.features,
        imageUrl: basic.imageUrl, eventType: null, isActive: true,
      })
      .expect(200);

    const publicList = await api.get('/api/packages');
    expect(publicList.body.map((p: { name: string; price: number }) => [p.name, p.price])).toEqual([['Basic', 1650]]);
  });

  it('never touches existing production data (repeated deploys)', async () => {
    await seed(prisma, production);
    // נתונים "אמיתיים" שהמנהלת יצרה
    await prisma.package.update({ where: { id: 1 }, data: { name: 'Renamed', price: 1999, isActive: false } });
    const client = await prisma.user.create({ data: { fullName: 'Real Client', email: 'real@client.test', passwordHash: 'x', role: 'Client' } });
    await prisma.event.create({
      data: {
        eventName: 'Real event', clientName: 'Real Client', clientEmail: 'real@client.test', eventType: 'Birthday',
        eventDate: new Date('2027-01-01'), location: 'Haifa', packageId: 2, themeColor: 'gold', guestCount: 10, budget: 500,
        userId: client.id,
      },
    });
    const before = {
      packages: await prisma.package.findMany({ orderBy: { id: 'asc' } }),
      users: await prisma.user.findMany({ orderBy: { id: 'asc' } }),
      events: await prisma.event.findMany({ orderBy: { id: 'asc' } }),
    };

    await seed(prisma, production);
    await seed(prisma, production);

    expect(await prisma.package.findMany({ orderBy: { id: 'asc' } })).toEqual(before.packages); // "Basic" לא חזרה
    expect(await prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(before.users);
    expect(await prisma.event.findMany({ orderBy: { id: 'asc' } })).toEqual(before.events);
    expect(await prisma.galleryItem.count()).toBe(0);
  });

  it('seedOptionsFromEnv with NODE_ENV=production disables every kind of demo data', () => {
    const options = seedOptionsFromEnv({
      NODE_ENV: 'production',
      SEED_ADMIN_PASSWORD: 'Production-Secret-1',
      SEED_CLIENT_PASSWORD: 'Client-Secret-1',
      SEED_DEMO_PACKAGES: 'true',
    });
    expect(options).toMatchObject({ isProduction: true, clientPassword: null, demoPackages: false });
    expect(seedOptionsFromEnv({ NODE_ENV: 'production' }).adminPassword).toBeNull(); // אין סיסמת פיתוח ידועה
  });
});

describe('Seed in development', () => {
  it('creates general packages, demo packages for every event type, admin, clients, events and gallery', async () => {
    await seed(prisma, development);
    const c = await counts();
    expect(c).toMatchObject({ clients: 2, events: 6, gallery: 10, packages: 3 + DEMO_TYPE_PACKAGES.length });
    for (const type of ['Birthday', 'BatMitzvah', 'Brit', 'Corporate', 'Private'] as const) {
      expect(await prisma.package.count({ where: { eventType: type, isActive: true } })).toBeGreaterThan(0);
    }
    // אירועי ההדגמה משויכים לחבילות כלליות – בלי חוסר התאמה לסוג
    expect(await prisma.event.count({ where: { package: { eventType: { not: null } } } })).toBe(0);
    // בפיתוח ההתנהגות לא השתנתה: החבילות הכלליות פעילות
    expect(await prisma.package.count({ where: { eventType: null, isActive: true } })).toBe(3);
  });

  it('SEED_DEMO_PACKAGES=false skips the demo packages', async () => {
    const options = seedOptionsFromEnv({ NODE_ENV: 'development', SEED_DEMO_PACKAGES: 'false' });
    expect(options.demoPackages).toBe(false);
    await seed(prisma, { ...development, demoPackages: false });
    expect((await counts()).typePackages).toBe(0);
  });

  it('is idempotent and never overwrites existing packages', async () => {
    await seed(prisma, development);
    const demo = await prisma.package.findFirstOrThrow({ where: { eventType: 'Birthday' } });
    await prisma.package.update({ where: { id: demo.id }, data: { price: 1, description: 'Changed by admin' } });
    await prisma.package.update({ where: { id: 1 }, data: { price: 7777 } });
    const before = await prisma.package.findMany({ orderBy: { id: 'asc' } });

    await seed(prisma, development);

    expect(await prisma.package.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.event.count()).toBe(6);
  });

  it('on an existing database adds only the missing demo packages and keeps the existing ones untouched', async () => {
    await prisma.package.createMany({
      data: [
        { name: 'Basic', description: 'Existing', price: 1200, features: ['x'], imageUrl: 'https://img.test/a.jpg' },
        { name: 'Premium', description: 'Existing', price: 2800, features: ['x'], imageUrl: 'https://img.test/b.jpg' },
      ],
    });
    const existing = await prisma.package.findMany({ orderBy: { id: 'asc' } });

    await seed(prisma, development);

    const general = await prisma.package.findMany({ where: { eventType: null }, orderBy: { id: 'asc' } });
    expect(general).toEqual(existing); // לא נוספה Luxury ולא שונו הקיימות
    expect((await counts()).typePackages).toBe(DEMO_TYPE_PACKAGES.length);
  });
});
