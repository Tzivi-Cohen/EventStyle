import type { EventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { fromDateOnly, toEventDto } from '../utils/mappers';
import { toPage, toSkipTake } from '../utils/pagination';
import { removeImagesSafely } from './storage/imageStorage';
import { assertPackageAllowedForEvent } from './packages.service';
import {
  copyCreatedMeanwhile,
  hideCopiesForRemoval,
  photoOrder,
  removeGalleryCopies,
  storageDeleteFailed,
  toPhotoDtos,
} from './photos.service';
import type { EventBodyInput, EventListQuery } from '../schemas/event.schema';
import type { PaginationQuery } from '../schemas/common.schema';

const listInclude = {
  package: { select: { id: true, name: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.EventInclude;

const detailsInclude = {
  package: { select: { id: true, name: true } },
  photos: { orderBy: photoOrder, include: { galleryItem: { select: { id: true, isPublished: true } } } },
} satisfies Prisma.EventInclude;

type EventDetails = Prisma.EventGetPayload<{ include: typeof detailsInclude }>;

/** אירוע בודד עם התמונות שלו. קישורי הצפייה לתמונות נוצרים רק כאן – אחרי בדיקת ההרשאות */
function toEventDetailsDto(event: EventDetails, user: Express.AuthUser) {
  const isAdmin = user.role === 'Admin';
  return toEventDto(event, isAdmin, toPhotoDtos(event.photos, user));
}

/**
 * קישור אירוע ללקוח: רק משתמש Client שאימת את כתובת האימייל שלו.
 * אם אין משתמש כזה – userId נשאר ריק, והקישור יתבצע כשהלקוח יאמת את האימייל.
 */
async function resolveVerifiedClientId(clientEmail: string): Promise<number | null> {
  const user = await prisma.user.findFirst({
    where: { email: clientEmail, role: 'Client', emailVerified: true },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function findEventOr404(id: number) {
  const event = await prisma.event.findUnique({ where: { id }, include: detailsInclude });
  if (!event) throw HttpError.notFound('Event not found');
  return event;
}

function toEventData(input: EventBodyInput) {
  return {
    eventName: input.eventName,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    eventType: input.eventType,
    eventDate: fromDateOnly(input.eventDate),
    location: input.location,
    packageId: input.packageId,
    themeColor: input.themeColor,
    guestCount: input.guestCount,
    budget: input.budget,
    coverImageUrl: input.coverImageUrl,
    notes: input.notes,
  };
}

/** כל האירועים (מנהלת) – חיפוש, סינון ומיון מתבצעים ב-PostgreSQL */
export async function listEvents(query: EventListQuery) {
  const where: Prisma.EventWhereInput = {
    ...(query.eventType && { eventType: query.eventType }),
    ...(query.status && { status: query.status }),
    ...(query.packageId && { packageId: query.packageId }),
    ...(query.search && {
      OR: [
        { eventName: { contains: query.search, mode: 'insensitive' } },
        { clientName: { contains: query.search, mode: 'insensitive' } },
      ],
    }),
  };

  // המיון המשני לפי id מבטיח סדר יציב בין עמודים (בלי כפילויות או דילוגים)
  const [totalItems, events] = await prisma.$transaction([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      include: listInclude,
      orderBy: [{ [query.sortBy]: query.sortDir }, { id: query.sortDir }],
      ...toSkipTake(query),
    }),
  ]);
  return toPage(
    events.map((event) => toEventDto(event, true)),
    totalItems,
    query,
  );
}

/** האירועים של המשתמש המחובר בלבד – לפי userId מתוך ה-Token */
export async function listMyEvents(user: Express.AuthUser, pagination: PaginationQuery) {
  const where: Prisma.EventWhereInput = { userId: user.id };
  const [totalItems, events] = await prisma.$transaction([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      include: listInclude,
      orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
      ...toSkipTake(pagination),
    }),
  ]);
  return toPage(
    events.map((event) => toEventDto(event, user.role === 'Admin')),
    totalItems,
    pagination,
  );
}

/** אירוע בודד: מנהלת – כל אירוע; לקוח – רק אירוע שמשויך אליו (אחרת 403) */
export async function getEvent(id: number, user: Express.AuthUser) {
  const event = await findEventOr404(id);
  if (user.role !== 'Admin' && event.userId !== user.id) {
    throw HttpError.forbidden('You do not have access to this event');
  }
  return toEventDetailsDto(event, user);
}

/**
 * יצירת אירוע: החבילה חייבת להיות פעילה, ומסוג האירוע או כללית.
 * הבדיקה והיצירה באותו Transaction, עם נעילת שורת החבילה (ראו assertPackageAllowedForEvent).
 */
export async function createEvent(input: EventBodyInput, user: Express.AuthUser) {
  const userId = await resolveVerifiedClientId(input.clientEmail);
  const event = await prisma.$transaction(async (tx) => {
    await assertPackageAllowedForEvent(tx, input.packageId, input.eventType);
    return tx.event.create({
      data: { ...toEventData(input), status: input.status ?? 'New', userId },
      include: detailsInclude,
    });
  });
  return toEventDetailsDto(event, user);
}

/**
 * עריכת אירוע: אותם כללים כמו ביצירה. התאמת הסוג נבדקת תמיד – גם כשמשנים רק את eventType של האירוע.
 * חבילה שעברה לארכיון מותרת רק אם האירוע כבר משויך אליה.
 */
export async function updateEvent(id: number, input: EventBodyInput, user: Express.AuthUser) {
  const existing = await findEventOr404(id);
  const userId = await resolveVerifiedClientId(input.clientEmail);
  const event = await prisma.$transaction(async (tx) => {
    await assertPackageAllowedForEvent(tx, input.packageId, input.eventType, existing.packageId);
    return tx.event.update({
      where: { id },
      data: { ...toEventData(input), status: input.status ?? existing.status, userId },
      include: detailsInclude,
    });
  });
  return toEventDetailsDto(event, user);
}

export async function updateEventStatus(id: number, status: EventStatus, user: Express.AuthUser) {
  await findEventOr404(id);
  const event = await prisma.event.update({ where: { id }, data: { status }, include: detailsInclude });
  return toEventDetailsDto(event, user);
}

/**
 * מחיקת אירוע, כולל כל התמונות שלו והעותקים הציבוריים שנוצרו מהן בגלריה.
 * 1. Transaction: נעילת האירוע והתמונות, ביטול ההסכמות והסתרת כל העותקים מיד.
 * 2. מחיקת העותקים מהאחסון (invalidate) ומהגלריה. אם מחיקה אחת נכשלת → 502 STORAGE_DELETE_FAILED, והאירוע
 *    לא נמחק: העותקים שנכשלו נשארים מוסתרים ומקושרים לתמונות – ניסיון חוזר ימשיך מאותה נקודה.
 * 3. Transaction: נעילה מחדש ומחיקת האירוע (התמונות נמחקות ב-Cascade), ואז הקבצים שלהן מהאחסון –
 *    כל אחד לפי סוג האחסון שלו. התמונות נקראות אחרי הנעילה, כך שגם תמונה שהועלתה ממש לפני המחיקה נמחקת.
 * פריטי גלריה שאינם מקושרים לתמונות האירוע לא נוגעים בהם.
 */
export async function deleteEvent(id: number) {
  const lockEvent = async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Events" WHERE id = ${id} FOR UPDATE`;
    if (locked.length === 0) throw HttpError.notFound('Event not found');
    // נעילת שורות התמונות: פרסום מקביל (שנועל את שורת התמונה) מסתיים לפני הבדיקה, או נכשל אחרי המחיקה
    return tx.$queryRaw<{ id: number }[]>`SELECT id FROM "EventPhotos" WHERE "eventId" = ${id} FOR UPDATE`;
  };

  const copies = await prisma.$transaction(async (tx) => {
    const photos = await lockEvent(tx);
    return hideCopiesForRemoval(tx, photos.map((p) => p.id));
  });
  const failed = await removeGalleryCopies(copies);
  if (failed.length > 0) throw storageDeleteFailed(failed);

  const photos = await prisma.$transaction(async (tx) => {
    await lockEvent(tx);
    const remaining = await tx.galleryItem.findMany({ where: { sourceEventPhoto: { eventId: id } }, select: { id: true } });
    if (remaining.length > 0) throw copyCreatedMeanwhile(remaining.map((item) => item.id));
    const eventPhotos = await tx.eventPhoto.findMany({ where: { eventId: id }, select: { publicId: true, storageType: true } });
    await tx.event.delete({ where: { id } });
    return eventPhotos;
  });
  await Promise.all([
    removeImagesSafely(photos.filter((p) => p.storageType === 'public').map((p) => p.publicId)),
    removeImagesSafely(photos.filter((p) => p.storageType === 'authenticated').map((p) => p.publicId), { access: 'authenticated' }),
  ]);
}
