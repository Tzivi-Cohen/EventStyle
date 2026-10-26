/**
 * EventStyle – נתוני הדגמה (Seed)
 *
 * - בטוח להרצה חוזרת: יוצר רק מה שחסר ולא דורס נתונים קיימים.
 * - חשבון Admin נוצר רק כאן (אי אפשר להירשם כ-Admin דרך ה-API).
 * - ב-Production חובה להגדיר SEED_ADMIN_PASSWORD; אין סיסמאות ידועות מראש.
 * - כל השמות והפרטים מומצאים.
 */
import 'dotenv/config';
import { PrismaClient, type EventStatus, type EventType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === 'production';

const DEV_ADMIN_PASSWORD = 'Admin12345';
const DEV_CLIENT_PASSWORD = 'Client12345';

function resolvePassword(envName: string, devDefault: string): string | null {
  const value = process.env[envName]?.trim();
  if (value) {
    if (value.length < 8) throw new Error(`${envName} must be at least 8 characters`);
    return value;
  }
  return isProduction ? null : devDefault;
}

const PACKAGES = [
  {
    name: 'Basic',
    description: 'עיצוב שולחן מרכזי, צבעים ואביזרים בסיסיים',
    price: 1200,
    features: ['עיצוב שולחן מרכזי', 'התאמת צבעים לאירוע', 'אביזרים בסיסיים'],
    imageUrl: 'https://picsum.photos/seed/eventstyle-basic/800/600',
  },
  {
    name: 'Premium',
    description: 'עיצוב שולחן, בלונים, רקע צילום ואביזרים',
    price: 2800,
    features: ['עיצוב שולחן', 'בלונים', 'רקע צילום', 'אביזרים משלימים'],
    imageUrl: 'https://picsum.photos/seed/eventstyle-premium/800/600',
  },
  {
    name: 'Luxury',
    description: 'עיצוב קונספט מלא, פרחים, בלונים ורקע מעוצב',
    price: 5500,
    features: ['עיצוב קונספט מלא', 'סידורי פרחים', 'קשתות בלונים', 'רקע מעוצב', 'ליווי מעצבת ביום האירוע'],
    imageUrl: 'https://picsum.photos/seed/eventstyle-luxury/800/600',
  },
];

const CLIENTS = [
  { fullName: 'נועה לוי', email: 'noa.levi@example.com', phone: '050-1234567' },
  { fullName: 'דניאל כהן', email: 'daniel.cohen@example.com', phone: '052-7654321' },
];

const GALLERY: { title: string; category: EventType }[] = [
  { title: 'יום הולדת בגווני פסטל', category: 'Birthday' },
  { title: 'שולחן מתוקים ליום הולדת 5', category: 'Birthday' },
  { title: 'בת מצווה בגווני זהב ולבן', category: 'BatMitzvah' },
  { title: 'רקע צילום פרחוני לבת מצווה', category: 'BatMitzvah' },
  { title: 'ברית בתכלת ולבן', category: 'Brit' },
  { title: 'בריתה בוורוד עדין', category: 'Brit' },
  { title: 'כנס חברה בעיצוב מינימליסטי', category: 'Corporate' },
  { title: 'ערב הוקרה לעובדים', category: 'Corporate' },
  { title: 'מסיבת אירוסין בגינה', category: 'Private' },
  { title: 'ארוחת ערב חגיגית בבית', category: 'Private' },
];

async function main() {
  console.log('🌱 Seeding EventStyle database...');

  // ---------- חבילות ----------
  for (const pkg of PACKAGES) {
    await prisma.package.upsert({ where: { name: pkg.name }, update: {}, create: pkg });
  }
  const packages = Object.fromEntries(
    (await prisma.package.findMany()).map((pkg) => [pkg.name, pkg.id]),
  ) as Record<string, number>;
  console.log('   ✓ packages');

  // ---------- מנהלת ----------
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@eventstyle.example').trim().toLowerCase();
  const adminPassword = resolvePassword('SEED_ADMIN_PASSWORD', DEV_ADMIN_PASSWORD);
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`   ✓ admin already exists (${adminEmail})`);
  } else if (!adminPassword) {
    console.warn('   ⚠ SEED_ADMIN_PASSWORD is not set – admin was NOT created (required in production)');
  } else {
    await prisma.user.create({
      data: {
        fullName: 'מנהלת הסטודיו',
        email: adminEmail,
        phone: '050-0000000',
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: 'Admin',
        emailVerified: true,
      },
    });
    console.log(`   ✓ admin created (${adminEmail})`);
  }

  // ---------- לקוחות לדוגמה (מאומתים) ----------
  const clientPassword = resolvePassword('SEED_CLIENT_PASSWORD', DEV_CLIENT_PASSWORD);
  if (!clientPassword) {
    console.warn('   ⚠ SEED_CLIENT_PASSWORD is not set – demo clients were NOT created');
  } else {
    const clientHash = await bcrypt.hash(clientPassword, 12);
    for (const client of CLIENTS) {
      await prisma.user.upsert({
        where: { email: client.email },
        update: {},
        create: { ...client, passwordHash: clientHash, role: 'Client', emailVerified: true },
      });
    }
    console.log('   ✓ demo clients');
  }
  const userIdByEmail = async (email: string) =>
    (await prisma.user.findFirst({ where: { email, role: 'Client', emailVerified: true } }))?.id ?? null;

  // ---------- אירועים (רק אם הטבלה ריקה) ----------
  if ((await prisma.event.count()) === 0) {
    const day = (offsetDays: number) => {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() + offsetDays);
      return date;
    };
    const events: {
      eventName: string; clientName: string; clientEmail: string; eventType: EventType; eventDate: Date;
      location: string; pkg: string; themeColor: string; guestCount: number; budget: number;
      status: EventStatus; notes?: string;
    }[] = [
      { eventName: 'יום הולדת 30 לנועה', clientName: 'נועה לוי', clientEmail: 'noa.levi@example.com', eventType: 'Birthday', eventDate: day(45), location: 'אולם הגן, תל אביב', pkg: 'Premium', themeColor: '#F4C2C2', guestCount: 80, budget: 4500, status: 'Planning', notes: 'להזמין בלונים בגוון ורוד עתיק' },
      { eventName: 'בת המצווה של מאיה', clientName: 'נועה לוי', clientEmail: 'noa.levi@example.com', eventType: 'BatMitzvah', eventDate: day(120), location: 'אחוזת השקמים, רמת גן', pkg: 'Luxury', themeColor: '#D4AF37', guestCount: 250, budget: 18000, status: 'New', notes: 'הלקוחה ביקשה פרחים לבנים בלבד' },
      { eventName: 'ברית לתינוק של משפחת כהן', clientName: 'דניאל כהן', clientEmail: 'daniel.cohen@example.com', eventType: 'Brit', eventDate: day(10), location: 'בית הכנסת המרכזי, חולון', pkg: 'Basic', themeColor: '#A7C7E7', guestCount: 60, budget: 1500, status: 'Preparing' },
      { eventName: 'ערב השקה – חברת טכנולוגיה', clientName: 'דניאל כהן', clientEmail: 'daniel.cohen@example.com', eventType: 'Corporate', eventDate: day(3), location: 'מרכז הכנסים, הרצליה', pkg: 'Luxury', themeColor: '#1F2A44', guestCount: 150, budget: 22000, status: 'Ready', notes: 'לתאם כניסה עם מנהל האולם' },
      { eventName: 'מסיבת אירוסין בגינה', clientName: 'שירה אברהם', clientEmail: 'shira.avraham@example.com', eventType: 'Private', eventDate: day(-20), location: 'גינה פרטית, כפר סבא', pkg: 'Premium', themeColor: '#B5C99A', guestCount: 40, budget: 3200, status: 'Completed' },
      { eventName: 'יום הולדת 7 לאורי', clientName: 'יוסי מזרחי', clientEmail: 'yossi.mizrahi@example.com', eventType: 'Birthday', eventDate: day(25), location: 'פארק הירקון, תל אביב', pkg: 'Basic', themeColor: '#FFB347', guestCount: 30, budget: 900, status: 'New' },
    ];

    for (const { pkg, ...event } of events) {
      await prisma.event.create({
        data: { ...event, packageId: packages[pkg]!, userId: await userIdByEmail(event.clientEmail) },
      });
    }
    console.log(`   ✓ ${events.length} demo events`);
  } else {
    console.log('   ✓ events already exist – skipped');
  }

  // ---------- גלריה (רק אם הטבלה ריקה) ----------
  if ((await prisma.galleryItem.count()) === 0) {
    await prisma.galleryItem.createMany({
      data: GALLERY.map((item, index) => ({
        ...item,
        url: `https://picsum.photos/seed/eventstyle-gallery-${index + 1}/1200/800`,
        publicId: null,
      })),
    });
    console.log(`   ✓ ${GALLERY.length} gallery items`);
  } else {
    console.log('   ✓ gallery already has items – skipped');
  }

  if (!isProduction) {
    console.log('\nDevelopment logins (do not use in production):');
    console.log(`   Admin:  ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD?.trim() ? '(from SEED_ADMIN_PASSWORD)' : DEV_ADMIN_PASSWORD}`);
    console.log(`   Client: ${CLIENTS.map((c) => c.email).join(', ')} / ${process.env.SEED_CLIENT_PASSWORD?.trim() ? '(from SEED_CLIENT_PASSWORD)' : DEV_CLIENT_PASSWORD}`);
  }
  console.log('🌱 Done.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
