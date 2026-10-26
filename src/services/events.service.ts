import type { EventStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { fromDateOnly, toEventDto, toPhotoDto } from '../utils/mappers';
import { toPage, toSkipTake } from '../utils/pagination';
import { getImageStorage, removeImagesSafely, type StoredImage } from './storage/imageStorage';
import { assertPackageAllowedForEvent } from './packages.service';
import type { EventBodyInput, EventListQuery } from '../schemas/event.schema';
import type { PaginationQuery } from '../schemas/common.schema';

const listInclude = {
  package: { select: { id: true, name: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.EventInclude;

const detailsInclude = {
  package: { select: { id: true, name: true } },
  photos: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.EventInclude;

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
  const isAdmin = user.role === 'Admin';
  if (!isAdmin && event.userId !== user.id) {
    throw HttpError.forbidden('You do not have access to this event');
  }
  return toEventDto(event, isAdmin);
}

/**
 * יצירת אירוע: החבילה חייבת להיות פעילה, ומסוג האירוע או כללית.
 * הבדיקה והיצירה באותו Transaction, עם נעילת שורת החבילה (ראו assertPackageAllowedForEvent).
 */
export async function createEvent(input: EventBodyInput) {
  const userId = await resolveVerifiedClientId(input.clientEmail);
  const event = await prisma.$transaction(async (tx) => {
    await assertPackageAllowedForEvent(tx, input.packageId, input.eventType);
    return tx.event.create({
      data: { ...toEventData(input), status: input.status ?? 'New', userId },
      include: detailsInclude,
    });
  });
  return toEventDto(event, true);
}

/**
 * עריכת אירוע: אותם כללים כמו ביצירה. התאמת הסוג נבדקת תמיד – גם כשמשנים רק את eventType של האירוע.
 * חבילה שעברה לארכיון מותרת רק אם האירוע כבר משויך אליה.
 */
export async function updateEvent(id: number, input: EventBodyInput) {
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
  return toEventDto(event, true);
}

export async function updateEventStatus(id: number, status: EventStatus) {
  await findEventOr404(id);
  const event = await prisma.event.update({ where: { id }, data: { status }, include: detailsInclude });
  return toEventDto(event, true);
}

export async function deleteEvent(id: number) {
  const event = await findEventOr404(id);
  // התמונות נמחקות מהטבלה אוטומטית (Cascade), ומשירות האחסון כאן
  await prisma.event.delete({ where: { id } });
  await removeImagesSafely(event.photos.map((photo) => photo.publicId));
}

/** העלאת תמונות לאירוע. אם אחת ההעלאות נכשלת – מוחקים את מה שכבר הועלה */
export async function addEventPhotos(id: number, files: Express.Multer.File[]) {
  await findEventOr404(id);
  const storage = getImageStorage();

  const results = await Promise.allSettled(files.map((file) => storage.upload(file, `events/${id}`)));
  const uploaded = results
    .filter((r): r is PromiseFulfilledResult<StoredImage> => r.status === 'fulfilled')
    .map((r) => r.value);
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    await removeImagesSafely(uploaded.map((image) => image.publicId));
    throw failure.reason;
  }

  const photos = await prisma.$transaction(
    uploaded.map((image) =>
      prisma.eventPhoto.create({ data: { eventId: id, url: image.url, publicId: image.publicId } }),
    ),
  );
  return photos.map(toPhotoDto);
}

export async function deleteEventPhoto(eventId: number, photoId: number) {
  const photo = await prisma.eventPhoto.findFirst({ where: { id: photoId, eventId } });
  if (!photo) throw HttpError.notFound('Photo not found for this event');
  await prisma.eventPhoto.delete({ where: { id: photo.id } });
  await removeImagesSafely([photo.publicId]);
}
