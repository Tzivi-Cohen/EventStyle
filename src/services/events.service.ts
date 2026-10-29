import { Prisma, type EventStatus } from '@prisma/client';
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
import { MAX_PENDING_REQUESTS, type EventBodyInput, type EventListQuery, type EventRequestInput, type EventRequestUpdate } from '../schemas/event.schema';
import { OPERATIONAL_EVENT_STATUSES } from '../schemas/common.schema';

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
 * קישור אירוע ללקוח: רק משתמש Client שהבעלות שלו על הכתובת הוכחה (emailVerified –
 * התחברות Google עם Gmail / Workspace, או חשבון שאומת בעבר). אין קוד אימות, ולכן חשבון סיסמה
 * חדש לא מקבל אוטומטית אירוע שנפתח לפי כתובת – אחרת מי שנרשם עם כתובת של אחרת היה רואה אותו.
 * אם אין משתמש כזה – userId נשאר ריק, והקישור יתבצע כשבעלת הכתובת תתחבר עם Google.
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

const isOperational = (status: EventStatus) => (OPERATIONAL_EVENT_STATUSES as readonly EventStatus[]).includes(status);

const duplicateRequest = () => HttpError.conflict('You already have a request or an event with this name on this date');

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
    // undefined = הטופס לא שלח את השדה – הטקסט שהלקוחה כתבה נשמר
    description: input.description,
    clientNotes: input.clientNotes,
  };
}

/** תנאי החיפוש והסינון – משותפים לרשימת המנהלת ולרשימת הלקוחה */
function toListWhere(query: EventListQuery, searchFields: ('eventName' | 'clientName')[]): Prisma.EventWhereInput {
  return {
    ...(query.eventType && { eventType: query.eventType }),
    ...(query.status && { status: query.status }),
    ...(query.packageId && { packageId: query.packageId }),
    ...((query.minBudget !== undefined || query.maxBudget !== undefined) && {
      budget: {
        ...(query.minBudget !== undefined && { gte: query.minBudget }),
        ...(query.maxBudget !== undefined && { lte: query.maxBudget }),
      },
    }),
    ...(query.search && {
      OR: searchFields.map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' as const } })),
    }),
  };
}

async function listPage(where: Prisma.EventWhereInput, query: EventListQuery, includeNotes: boolean) {
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
    events.map((event) => toEventDto(event, includeNotes)),
    totalItems,
    query,
  );
}

/** כל האירועים והבקשות (מנהלת) – חיפוש, סינון ומיון מתבצעים ב-PostgreSQL */
export function listEvents(query: EventListQuery) {
  return listPage(toListWhere(query, ['eventName', 'clientName']), query, true);
}

/**
 * האירועים והבקשות של המשתמש המחובר בלבד – לפי userId מתוך ה-Token.
 * החיפוש רק בשם האירוע (שם הלקוחה הוא תמיד שלה). תנאי userId תמיד גובר על הסינון.
 */
export function listMyEvents(user: Express.AuthUser, query: EventListQuery) {
  return listPage({ ...toListWhere(query, ['eventName']), userId: user.id }, query, user.role === 'Admin');
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
  // בקשה עוברת קודם אישור או דחייה. כך המנהלת לא דורסת עריכה של הלקוחה, ובקשה שנדחתה נשארת כפי שהייתה
  if (!isOperational(existing.status)) {
    throw HttpError.conflict('A request must be approved or rejected before it can be edited');
  }
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

/**
 * שינוי סטטוס תפעולי (מנהלת): מעבר חופשי בין New, Planning, Preparing, Ready ו-Completed – כדי לאפשר תיקון טעויות.
 * בקשה (Pending / Rejected) לא משתנה כאן: התנאי על הסטטוס הנוכחי הוא חלק מה-UPDATE עצמו (אטומי).
 */
export async function updateEventStatus(id: number, status: EventStatus, user: Express.AuthUser) {
  const { count } = await prisma.event.updateMany({
    where: { id, status: { in: [...OPERATIONAL_EVENT_STATUSES] } },
    data: { status },
  });
  if (count === 0) {
    await findEventOr404(id);
    throw HttpError.conflict('A request must be approved or rejected before its status can be managed');
  }
  return toEventDetailsDto(await findEventOr404(id), user);
}

/**
 * נעילת שורת המשתמשת עד סוף ה-Transaction: כל יצירה ועריכה של בקשות של אותה לקוחה מתבצעות בתור.
 * כך מגבלת הבקשות הפתוחות ובדיקת הכפילות נכונות גם בבקשות מקבילות.
 */
async function lockRequester(tx: Prisma.TransactionClient, userId: number) {
  const [row] = await tx.$queryRaw<{ fullName: string; email: string }[]>`
    SELECT "fullName", email FROM "Users" WHERE id = ${userId} FOR UPDATE`;
  if (!row) throw HttpError.unauthorized('User no longer exists');
  return row;
}

/**
 * בקשה כפולה: אותה לקוחה, אותו שם (בלי הבדל אותיות) ואותו תאריך – בבקשה ממתינה או באירוע שכבר אושר.
 * בקשה שנדחתה לא חוסמת: מותר לשלוח אותה שוב. שם או תאריך אחרים הם הזמנה חדשה ולגיטימית.
 */
async function assertNotDuplicate(tx: Prisma.TransactionClient, userId: number, eventName: string, eventDate: Date, exceptId?: number) {
  const duplicate = await tx.event.findFirst({
    where: {
      userId,
      eventDate,
      eventName: { equals: eventName, mode: 'insensitive' },
      status: { not: 'Rejected' },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (duplicate) throw duplicateRequest();
}

/** האינדקס Events_pending_request_key (בקשה ממתינה כפולה) – הגנה אחרונה מעבר לבדיקה בקוד */
function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateRequest();
  throw error;
}

/**
 * בקשת לקוחה לעיצוב אירוע: נוצרת בסטטוס Pending, משויכת למשתמשת מה-Token,
 * והשם והאימייל נלקחים מהחשבון (לא מהגוף). כל לקוחה מחוברת – אין דרישת אימות אימייל.
 */
export async function createRequest(input: EventRequestInput, user: Express.AuthUser) {
  try {
    const event = await prisma.$transaction(async (tx) => {
      const requester = await lockRequester(tx, user.id);
      const pending = await tx.event.count({ where: { userId: user.id, status: 'Pending' } });
      if (pending >= MAX_PENDING_REQUESTS) {
        throw new HttpError(409, 'CONFLICT', `You can have at most ${MAX_PENDING_REQUESTS} pending requests`, {
          limit: MAX_PENDING_REQUESTS,
          current: pending,
        });
      }
      const eventDate = fromDateOnly(input.eventDate);
      await assertNotDuplicate(tx, user.id, input.eventName, eventDate);
      await assertPackageAllowedForEvent(tx, input.packageId, input.eventType);
      return tx.event.create({
        data: {
          eventName: input.eventName,
          eventType: input.eventType,
          eventDate,
          location: input.location,
          packageId: input.packageId,
          themeColor: input.themeColor,
          guestCount: input.guestCount,
          budget: input.budget,
          description: input.description,
          clientNotes: input.clientNotes,
          clientName: requester.fullName,
          clientEmail: requester.email,
          userId: user.id,
          status: 'Pending',
        },
        include: detailsInclude,
      });
    });
    return toEventDetailsDto(event, user);
  } catch (error) {
    rethrowDuplicate(error);
  }
}

/**
 * עריכת בקשה ממתינה – רק בעלת הבקשה, ורק בסטטוס Pending.
 * שורת האירוע ננעלת (FOR UPDATE) לפני הבדיקה: אישור או דחייה במקביל ממתינים לסיום העריכה, או מסתיימים לפניה –
 * ואז העריכה רואה את הסטטוס החדש ונדחית ב-409. אין מצב שבו עריכה עוקפת אישור.
 */
export async function updateRequest(id: number, input: EventRequestUpdate, user: Express.AuthUser) {
  try {
    const event = await prisma.$transaction(async (tx) => {
      await lockRequester(tx, user.id);
      const [locked] = await tx.$queryRaw<{ userId: number | null; status: EventStatus }[]>`
        SELECT "userId", status FROM "Events" WHERE id = ${id} FOR UPDATE`;
      if (!locked) throw HttpError.notFound('Event not found');
      if (locked.userId !== user.id) throw HttpError.forbidden('You do not have access to this event');
      if (locked.status !== 'Pending') throw HttpError.conflict('Only a pending request can be edited');

      const existing = await tx.event.findUniqueOrThrow({ where: { id } });
      const eventName = input.eventName ?? existing.eventName;
      const eventType = input.eventType ?? existing.eventType;
      const eventDate = input.eventDate ? fromDateOnly(input.eventDate) : existing.eventDate;
      const packageId = input.packageId ?? existing.packageId;
      await assertNotDuplicate(tx, user.id, eventName, eventDate, id);
      await assertPackageAllowedForEvent(tx, packageId, eventType, existing.packageId);

      return tx.event.update({
        where: { id },
        data: {
          eventName,
          eventType,
          eventDate,
          packageId,
          location: input.location,
          themeColor: input.themeColor,
          guestCount: input.guestCount,
          budget: input.budget,
          description: input.description,
          clientNotes: input.clientNotes,
        },
        include: detailsInclude,
      });
    });
    return toEventDetailsDto(event, user);
  } catch (error) {
    rethrowDuplicate(error);
  }
}

/**
 * אישור או דחייה (מנהלת): UPDATE אחד עם התנאי status = Pending – אטומי.
 * אישור כפול, או אישור ודחייה במקביל: רק הראשון מצליח, השני מקבל 409. האישור לא יוצר רשומה חדשה.
 */
async function reviewRequest(id: number, user: Express.AuthUser, data: Prisma.EventUpdateManyMutationInput) {
  const { count } = await prisma.event.updateMany({
    where: { id, status: 'Pending' },
    data: { ...data, reviewedAt: new Date(), reviewedById: user.id },
  });
  if (count === 0) {
    await findEventOr404(id);
    throw HttpError.conflict('This request was already reviewed');
  }
  return toEventDetailsDto(await findEventOr404(id), user);
}

export function approveRequest(id: number, user: Express.AuthUser) {
  return reviewRequest(id, user, { status: 'New', rejectionReason: null });
}

export function rejectRequest(id: number, reason: string | null, user: Express.AuthUser) {
  return reviewRequest(id, user, { status: 'Rejected', rejectionReason: reason });
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
