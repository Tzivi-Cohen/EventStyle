/**
 * EventStyle – נתוני התחלה ונתוני הדגמה (Seed)
 *
 * - בטוח להרצה חוזרת: יוצר רק מה שחסר ולא דורס או משנה נתונים קיימים.
 * - חשבון Admin נוצר רק כאן (אי אפשר להירשם כ-Admin דרך ה-API).
 * - ב-Production (NODE_ENV=production) נוצרים רק נתוני התחלה הכרחיים:
 *   שלוש החבילות הכלליות (רק כשטבלת החבילות ריקה) וחשבון המנהלת (רק עם SEED_ADMIN_PASSWORD).
 *   לקוחות, אירועים, פריטי גלריה וחבילות לפי סוג אירוע הם נתוני הדגמה – והם לעולם לא נוצרים ב-Production.
 * - כל השמות והפרטים מומצאים.
 */
import 'dotenv/config';
import { PrismaClient, type EventStatus, type EventType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DEV_ADMIN_PASSWORD = 'Admin12345';
const DEV_CLIENT_PASSWORD = 'Client12345';

/** שלוש החבילות הכלליות (eventType = null) – המחירון הבסיסי של האתר. המחירים הם ערכי הדגמה */
const BASE_PACKAGES = [
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

/** חבילות הדגמה לפי סוג אירוע – לסביבת פיתוח בלבד */
export const DEMO_TYPE_PACKAGES: {
  eventType: EventType;
  name: string;
  description: string;
  price: number;
  features: string[];
  sortOrder: number;
}[] = [
  { eventType: 'Birthday', name: 'יום הולדת קלאסי', description: 'שולחן מתוקים ובלונים בצבעי האירוע', price: 1500, features: ['שולחן מתוקים מעוצב', 'קשת בלונים קטנה', 'שלט ברכה אישי'], sortOrder: 1 },
  { eventType: 'Birthday', name: 'יום הולדת חגיגי', description: 'עיצוב מלא כולל רקע צילום וקשת בלונים גדולה', price: 3200, features: ['שולחן מתוקים', 'קשת בלונים גדולה', 'רקע צילום', 'עיצוב שולחנות אורחים'], sortOrder: 2 },
  { eventType: 'BatMitzvah', name: 'בת מצווה אלגנטית', description: 'עיצוב בגווני זהב ולבן עם פינת צילום', price: 4200, features: ['פינת צילום', 'קיר בלונים', 'מרכזי שולחן'], sortOrder: 1 },
  { eventType: 'BatMitzvah', name: 'בת מצווה קונספט', description: 'קונספט מלא לפי בחירת בת המצווה', price: 7800, features: ['קונספט אישי', 'סידורי פרחים', 'רקע מעוצב', 'ליווי ביום האירוע'], sortOrder: 2 },
  { eventType: 'Brit', name: 'ברית עדינה', description: 'עיצוב עדין בגווני תכלת או ורוד', price: 1300, features: ['שולחן כיבוד מעוצב', 'בלונים בגוונים עדינים'], sortOrder: 1 },
  { eventType: 'Brit', name: 'ברית מורחבת', description: 'עיצוב אולם קטן כולל פינת צילום משפחתית', price: 2600, features: ['שולחן כיבוד', 'פינת צילום', 'מרכזי שולחן'], sortOrder: 2 },
  { eventType: 'Corporate', name: 'כנס חברה', description: 'עיצוב מינימליסטי בצבעי המותג', price: 5000, features: ['עמדת קבלת פנים', 'מרכזי שולחן', 'שילוט ממותג'], sortOrder: 1 },
  { eventType: 'Corporate', name: 'ערב הוקרה', description: 'עיצוב ערב חגיגי לעובדים', price: 9500, features: ['קונספט מלא', 'במה מעוצבת', 'פינת צילום', 'מרכזי שולחן'], sortOrder: 2 },
  { eventType: 'Private', name: 'אירוע ביתי', description: 'עיצוב חגיגי לאירוע בבית או בגינה', price: 1800, features: ['שולחן מרכזי', 'תאורה דקורטיבית', 'בלונים'], sortOrder: 1 },
  { eventType: 'Private', name: 'אירוסין בגינה', description: 'עיצוב רומנטי עם פרחים ותאורה', price: 4600, features: ['קשת פרחים', 'תאורה דקורטיבית', 'פינת צילום'], sortOrder: 2 },
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

export interface SeedOptions {
  /** ב-Production לא נוצר אף נתון הדגמה */
  isProduction: boolean;
  adminEmail: string;
  /** סיסמת המנהלת. ב-Production בלי סיסמה – המנהלת לא נוצרת */
  adminPassword: string | null;
  /** סיסמת לקוחות ההדגמה (פיתוח בלבד) */
  clientPassword: string | null;
  /** חבילות הדגמה לפי סוג אירוע (פיתוח בלבד). SEED_DEMO_PACKAGES=false מבטל */
  demoPackages: boolean;
  log?: (message: string) => void;
}

/** קריאת ההגדרות ממשתני הסביבה. ב-Production אין סיסמאות ברירת מחדל ואין נתוני הדגמה */
export function seedOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): SeedOptions {
  const isProduction = env.NODE_ENV === 'production';
  const password = (name: string, devDefault: string): string | null => {
    const value = env[name]?.trim();
    if (value) {
      if (value.length < 8) throw new Error(`${name} must be at least 8 characters`);
      return value;
    }
    return isProduction ? null : devDefault;
  };
  return {
    isProduction,
    adminEmail: (env.SEED_ADMIN_EMAIL ?? 'admin@eventstyle.example').trim().toLowerCase(),
    adminPassword: password('SEED_ADMIN_PASSWORD', DEV_ADMIN_PASSWORD),
    clientPassword: isProduction ? null : password('SEED_CLIENT_PASSWORD', DEV_CLIENT_PASSWORD),
    demoPackages: !isProduction && env.SEED_DEMO_PACKAGES?.trim().toLowerCase() !== 'false',
  };
}

export async function seed(prisma: PrismaClient, options: SeedOptions) {
  const log = options.log ?? console.log;
  const allowDemo = !options.isProduction;

  // ---------- חבילות כלליות: רק בהקמה ראשונה (טבלה ריקה) ----------
  // כך הרצה חוזרת לא תחזיר חבילה שהמנהלת שינתה את שמה או העבירה לארכיון
  if ((await prisma.package.count()) === 0) {
    await prisma.package.createMany({ data: BASE_PACKAGES });
    log(`   ✓ ${BASE_PACKAGES.length} general packages`);
  } else {
    log('   ✓ packages already exist – general packages skipped');
  }

  // ---------- חבילות הדגמה לפי סוג אירוע (פיתוח בלבד) ----------
  if (allowDemo && options.demoPackages) {
    let created = 0;
    for (const [index, pkg] of DEMO_TYPE_PACKAGES.entries()) {
      const exists = await prisma.package.findFirst({ where: { eventType: pkg.eventType, name: pkg.name } });
      if (exists) continue; // לא דורסים ולא משנים חבילה קיימת
      await prisma.package.create({
        data: { ...pkg, imageUrl: `https://picsum.photos/seed/eventstyle-type-${index + 1}/800/600` },
      });
      created++;
    }
    log(`   ✓ demo packages by event type (${created} created)`);
  }

  // ---------- מנהלת ----------
  const existingAdmin = await prisma.user.findUnique({ where: { email: options.adminEmail } });
  if (existingAdmin) {
    log(`   ✓ admin already exists (${options.adminEmail})`);
  } else if (!options.adminPassword) {
    log('   ⚠ SEED_ADMIN_PASSWORD is not set – admin was NOT created (required in production)');
  } else {
    await prisma.user.create({
      data: {
        fullName: 'מנהלת הסטודיו',
        email: options.adminEmail,
        phone: '050-0000000',
        passwordHash: await bcrypt.hash(options.adminPassword, 12),
        role: 'Admin',
        emailVerified: true,
      },
    });
    log(`   ✓ admin created (${options.adminEmail})`);
  }

  if (!allowDemo) {
    log('   ✓ production: demo clients, events and gallery items are never created');
    return;
  }

  // ---------- לקוחות לדוגמה (מאומתים, פיתוח בלבד) ----------
  if (options.clientPassword) {
    const clientHash = await bcrypt.hash(options.clientPassword, 12);
    for (const client of CLIENTS) {
      await prisma.user.upsert({
        where: { email: client.email },
        update: {},
        create: { ...client, passwordHash: clientHash, role: 'Client', emailVerified: true },
      });
    }
    log('   ✓ demo clients');
  }
  const userIdByEmail = async (email: string) =>
    (await prisma.user.findFirst({ where: { email, role: 'Client', emailVerified: true } }))?.id ?? null;

  // ---------- אירועים לדוגמה (רק אם הטבלה ריקה, פיתוח בלבד) ----------
  if ((await prisma.event.count()) === 0) {
    const general = Object.fromEntries(
      (await prisma.package.findMany({ where: { eventType: null } })).map((pkg) => [pkg.name, pkg.id]),
    ) as Record<string, number>;
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

    // אירועי הדגמה משויכים רק לחבילות הכלליות שקיימות (אם המנהלת שינתה אותן – האירוע מדולג)
    let created = 0;
    for (const { pkg, ...event } of events) {
      const packageId = general[pkg];
      if (!packageId) continue;
      await prisma.event.create({ data: { ...event, packageId, userId: await userIdByEmail(event.clientEmail) } });
      created++;
    }
    log(`   ✓ ${created} demo events`);
  } else {
    log('   ✓ events already exist – skipped');
  }

  // ---------- גלריה לדוגמה (רק אם הטבלה ריקה, פיתוח בלבד) ----------
  if ((await prisma.galleryItem.count()) === 0) {
    await prisma.galleryItem.createMany({
      data: GALLERY.map((item, index) => ({
        ...item,
        url: `https://picsum.photos/seed/eventstyle-gallery-${index + 1}/1200/800`,
        publicId: null,
      })),
    });
    log(`   ✓ ${GALLERY.length} gallery items`);
  } else {
    log('   ✓ gallery already has items – skipped');
  }
}

async function main() {
  const prisma = new PrismaClient();
  const options = seedOptionsFromEnv();
  try {
    console.log(`🌱 Seeding EventStyle database (${options.isProduction ? 'production' : 'development'})...`);
    await seed(prisma, options);
    if (!options.isProduction) {
      console.log('\nDevelopment logins (do not use in production):');
      console.log(`   Admin:  ${options.adminEmail} / ${process.env.SEED_ADMIN_PASSWORD?.trim() ? '(from SEED_ADMIN_PASSWORD)' : DEV_ADMIN_PASSWORD}`);
      console.log(`   Client: ${CLIENTS.map((c) => c.email).join(', ')} / ${process.env.SEED_CLIENT_PASSWORD?.trim() ? '(from SEED_CLIENT_PASSWORD)' : DEV_CLIENT_PASSWORD}`);
    }
    console.log('🌱 Done.');
  } finally {
    await prisma.$disconnect();
  }
}

// רץ רק כשמפעילים את הקובץ ישירות (npm run db:seed / start:render), לא כשבדיקות מייבאות אותו
if (require.main === module) {
  main().catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
