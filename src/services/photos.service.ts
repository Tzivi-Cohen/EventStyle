import { createHash } from 'node:crypto';
import { Prisma, type EventPhoto, type EventStatus, type GalleryItem } from '@prisma/client';
import { PHOTOS } from '../config/photos';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { toAdminGalleryDto, toPhotoDto, type PhotoLink, type PhotoViewer, type PhotoWithGallery } from '../utils/mappers';
import { toPage, toSkipTake } from '../utils/pagination';
import {
  getImageStorage,
  removeImagesSafely,
  type CopySource,
  type ImageAccess,
  type PrivateStoredImage,
} from './storage/imageStorage';
import type { AdminPhotoQuery, PublishBodyInput } from '../schemas/photo.schema';

export const MAX_PHOTOS_PER_EVENT = PHOTOS.MAX_PER_EVENT;

/**
 * בתמונה פרטית (authenticated) עמודת url לא מכילה קישור: נשמר בה רק הפורמט, בצורה "authenticated:<format>",
 * כי הוא נדרש ליצירת קישור זמני. הערך הזה לעולם לא נשלח ללקוח.
 */
const PRIVATE_URL_PREFIX = 'authenticated:';

const galleryInclude = { galleryItem: { select: { id: true, isPublished: true } } } satisfies Prisma.EventPhotoInclude;
/** סדר התמונות: מהישנה לחדשה (id לסדר יציב) */
export const photoOrder = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.EventPhotoOrderByWithRelationInput[];

type Db = Prisma.TransactionClient | typeof prisma;

const viewerOf = (user: Express.AuthUser): PhotoViewer => ({ id: user.id, isAdmin: user.role === 'Admin' });
const accessOf = (photo: Pick<EventPhoto, 'storageType'>): ImageAccess => photo.storageType;
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const photoNotFound = () => HttpError.notFound('Photo not found for this event');

/**
 * גישה לתמונות של אירוע: מנהלת – כל אירוע; לקוחה – רק אירוע שמשויך אליה (userId מתוך ה-Token).
 * אירוע בלי בעלים (userId = null) נגיש למנהלת בלבד. אירוע שלא קיים → 404, אירוע של אחרת → 403
 * (כמו GET /api/events/:id).
 */
export async function assertEventAccess(eventId: number, user: Express.AuthUser) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, userId: true, status: true } });
  if (!event) throw HttpError.notFound('Event not found');
  if (user.role !== 'Admin' && (event.userId === null || event.userId !== user.id)) {
    throw HttpError.forbidden('You do not have access to this event');
  }
  return event;
}

/** קישור לצפייה. תמונה פרטית: קישור חתום וזמני (ברירת מחדל 10 דקות). נקרא רק אחרי בדיקת הרשאות */
export function createPhotoLink(photo: EventPhoto): PhotoLink {
  if (photo.storageType === 'public') return { url: photo.url, expiresAt: null };
  if (!photo.publicId || !photo.url.startsWith(PRIVATE_URL_PREFIX)) {
    throw new Error(`Private photo ${photo.id} is missing its storage reference`);
  }
  return getImageStorage().getPrivateDownloadUrl(photo.publicId, photo.url.slice(PRIVATE_URL_PREFIX.length));
}

/** ברשימות: כשל ביצירת קישור (למשל אחסון לא מוגדר) לא מפיל את כל התשובה – התמונה מוחזרת עם url=null */
function tryCreatePhotoLink(photo: EventPhoto): PhotoLink | null {
  try {
    return createPhotoLink(photo);
  } catch (error) {
    console.error(`Could not create a view link for photo ${photo.id}:`, (error as Error).message);
    return null;
  }
}

export function toPhotoDtos(photos: PhotoWithGallery[], user: Express.AuthUser) {
  const viewer = viewerOf(user);
  return photos.map((photo) => toPhotoDto(photo, viewer, tryCreatePhotoLink(photo)));
}

/** כל התמונות של אירוע, עם קישורי צפייה חדשים */
export async function listEventPhotos(eventId: number, user: Express.AuthUser) {
  await assertEventAccess(eventId, user);
  const photos = await prisma.eventPhoto.findMany({ where: { eventId }, include: galleryInclude, orderBy: photoOrder });
  return toPhotoDtos(photos, user);
}

/** תמונה אחת עם קישור צפייה חדש – לרענון קישור שפג תוקפו. כאן כשל ביצירת הקישור מוחזר כשגיאה */
export async function getEventPhoto(eventId: number, photoId: number, user: Express.AuthUser) {
  await assertEventAccess(eventId, user);
  const photo = await prisma.eventPhoto.findFirst({ where: { id: photoId, eventId }, include: galleryInclude });
  if (!photo) throw photoNotFound();
  return toPhotoDto(photo, viewerOf(user), createPhotoLink(photo));
}

/** לקוחה מעלה תמונות רק לאירוע שאושר – לא לבקשה ממתינה או שנדחתה */
function assertRequestApproved(status: EventStatus) {
  if (status === 'Pending' || status === 'Rejected') {
    throw HttpError.conflict('Photos can be added only after the request is approved');
  }
}

/**
 * בדיקה מוקדמת לפני קבלת הקבצים (לפני multer ועיבוד התמונות): הרשאה, ושהאירוע עוד לא מלא.
 * הבדיקה המחייבת נעשית שוב בתוך ה-Transaction שבו התמונות נשמרות.
 */
export async function assertCanUpload(eventId: number, user: Express.AuthUser) {
  const event = await assertEventAccess(eventId, user);
  if (user.role !== 'Admin') assertRequestApproved(event.status);
  const count = await prisma.eventPhoto.count({ where: { eventId } });
  if (count >= MAX_PHOTOS_PER_EVENT) throw photoLimitReached(count, 1);
}

function photoLimitReached(current: number, requested: number) {
  return new HttpError(
    409,
    'PHOTO_LIMIT_REACHED',
    `An event can have at most ${MAX_PHOTOS_PER_EVENT} photos (currently ${current})`,
    { limit: MAX_PHOTOS_PER_EVENT, current, requested },
  );
}

interface HashedFile {
  file: Express.Multer.File;
  hash: string;
}

/** כפילות (אותו קובץ מעובד כבר קיים באירוע) ומגבלת 50 התמונות */
async function assertRoomForPhotos(db: Db, eventId: number, files: HashedFile[]) {
  const existing = await db.eventPhoto.findMany({
    where: { eventId, contentHash: { in: files.map((f) => f.hash) } },
    select: { id: true, contentHash: true },
  });
  if (existing.length > 0) {
    throw new HttpError(409, 'DUPLICATE_PHOTO', 'This photo was already uploaded to this event', {
      duplicates: files
        .map((f) => ({ file: f.file.originalname, photoId: existing.find((e) => e.contentHash === f.hash)?.id }))
        .filter((d) => d.photoId !== undefined),
    });
  }
  const count = await db.eventPhoto.count({ where: { eventId } });
  if (count + files.length > MAX_PHOTOS_PER_EVENT) throw photoLimitReached(count, files.length);
}

/**
 * העלאת תמונות לאירוע (מנהלת או בעלת האירוע). כל התמונות החדשות נשמרות כ-authenticated (פרטיות).
 * 1. SHA-256 של הקובץ המעובד (אחרי הסרת המטא-דאטה) – כפילויות בתוך הבקשה ומול האירוע נדחות (409).
 * 2. בדיקה מוקדמת של כפילות ומגבלה, כדי לא להעלות קבצים לשווא.
 * 3. העלאה לאחסון. אם אחת נכשלת – מוחקים את מה שכבר הועלה.
 * 4. שמירה ב-Transaction שנועל את שורת האירוע (FOR UPDATE), כך שבקשות מקבילות לא עוברות את המגבלה,
 *    והאינדקס הייחודי (eventId, contentHash) חוסם כפילויות גם במקביל. כשל כאן מוחק את הקבצים שהועלו.
 */
export async function addEventPhotos(eventId: number, files: Express.Multer.File[], user: Express.AuthUser) {
  await assertEventAccess(eventId, user);
  const isAdmin = user.role === 'Admin';

  const hashed: HashedFile[] = files.map((file) => ({ file, hash: sha256(file.buffer) }));
  const repeated = hashed.filter((f, i) => hashed.findIndex((other) => other.hash === f.hash) !== i);
  if (repeated.length > 0) {
    throw new HttpError(409, 'DUPLICATE_PHOTO', 'The same photo was sent more than once in this request', {
      duplicates: repeated.map((f) => ({ file: f.file.originalname })),
    });
  }
  await assertRoomForPhotos(prisma, eventId, hashed);

  const storage = getImageStorage();
  const results = await Promise.allSettled(
    hashed.map((f) => storage.upload(f.file, `events/${eventId}`, { access: 'authenticated' })),
  );
  const uploaded = results
    .filter((r): r is PromiseFulfilledResult<PrivateStoredImage> => r.status === 'fulfilled')
    .map((r) => r.value);
  const cleanUp = () => removeImagesSafely(uploaded.map((image) => image.publicId), { access: 'authenticated' });
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    await cleanUp();
    throw failure.reason;
  }

  let photos: PhotoWithGallery[];
  try {
    photos = await prisma.$transaction(async (tx) => {
      const [event] = await tx.$queryRaw<{ userId: number | null; status: EventStatus }[]>`
        SELECT "userId", status FROM "Events" WHERE id = ${eventId} FOR UPDATE`;
      if (!event) throw HttpError.notFound('Event not found');
      // הבעלות עלולה להשתנות בזמן ההעלאה (למשל עריכת clientEmail בידי המנהלת)
      if (!isAdmin && event.userId !== user.id) throw HttpError.forbidden('You do not have access to this event');
      if (!isAdmin) assertRequestApproved(event.status);
      await assertRoomForPhotos(tx, eventId, hashed);

      const created: PhotoWithGallery[] = [];
      for (const [i, image] of uploaded.entries()) {
        created.push(
          await tx.eventPhoto.create({
            data: {
              eventId,
              url: `${PRIVATE_URL_PREFIX}${image.format}`,
              publicId: image.publicId,
              storageType: 'authenticated',
              uploadedById: user.id,
              contentHash: hashed[i].hash,
            },
            include: galleryInclude,
          }),
        );
      }
      return created;
    });
  } catch (error) {
    await cleanUp();
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'DUPLICATE_PHOTO', 'This photo was already uploaded to this event');
    }
    throw error;
  }
  return toPhotoDtos(photos, user);
}

type GalleryCopy = Pick<GalleryItem, 'id' | 'publicId'>;

/**
 * שלב 1 של הסרת עותקים (בתוך Transaction שכבר נעל את שורות התמונות):
 * לתמונות שיש להן עותק בגלריה – ביטול ההסכמה והסתרת העותק מיד מכל נתיב ציבורי.
 * ביטול ההסכמה מבטיח שהעותק לא יחזור לפרסום (PATCH) ושהתמונה לא תפורסם מחדש עד שהעותק יימחק.
 * הקישור לתמונת המקור נשמר – הוא המידע לניסיון ניקוי חוזר.
 */
export async function hideCopiesForRemoval(tx: Prisma.TransactionClient, photoIds: number[]): Promise<GalleryCopy[]> {
  if (photoIds.length === 0) return [];
  const copies = await tx.galleryItem.findMany({
    where: { sourceEventPhotoId: { in: photoIds } },
    select: { id: true, publicId: true, sourceEventPhotoId: true },
  });
  if (copies.length === 0) return [];
  await tx.eventPhoto.updateMany({
    where: { id: { in: copies.map((c) => c.sourceEventPhotoId!) } },
    data: { publishConsent: false },
  });
  await tx.galleryItem.updateMany({ where: { id: { in: copies.map((c) => c.id) } }, data: { isPublished: false } });
  return copies.map(({ id, publicId }) => ({ id, publicId }));
}

/**
 * שלב 2: מחיקת כל עותק מהאחסון (כולל invalidate של ה-CDN) ואז מחיקת הפריט.
 * עותק שהמחיקה שלו באחסון נכשלה נשאר בגלריה – מוסתר, עם ה-publicId והקישור למקור – לניסיון חוזר.
 * מחזיר את מזהי הפריטים שלא נמחקו.
 */
export async function removeGalleryCopies(copies: GalleryCopy[]): Promise<number[]> {
  const failed: number[] = [];
  for (const copy of copies) {
    try {
      if (copy.publicId) await getImageStorage().remove(copy.publicId, { access: 'public' });
      await prisma.galleryItem.deleteMany({ where: { id: copy.id } });
    } catch (error) {
      console.error(`Failed to remove gallery copy ${copy.id}; it stays hidden until removed:`, (error as Error).message);
      failed.push(copy.id);
    }
  }
  return failed;
}

export function storageDeleteFailed(galleryItemIds: number[]) {
  return new HttpError(
    502,
    'STORAGE_DELETE_FAILED',
    'The public gallery copy could not be removed from storage. It is hidden; please try again',
    { galleryItemIds },
  );
}

/** עותק חדש נוצר בין השלבים (הסכמה ופרסום מחדש במקביל) – המחיקה לא ממשיכה; ניסיון חוזר יסיר גם אותו */
export function copyCreatedMeanwhile(galleryItemIds: number[]) {
  return new HttpError(409, 'PHOTO_IN_GALLERY', 'A gallery copy was created while deleting. Please try again', { galleryItemIds });
}

/**
 * מחיקת תמונה: מנהלת – כל תמונה; בעלת האירוע – רק תמונות שהיא העלתה.
 * אם יש לתמונה עותק בגלריה, הוא מוסר קודם – ותמונת המקור נמחקת רק אחרי שהעותק נמחק מהאחסון:
 * 1. Transaction: נעילת השורה, הרשאה, ביטול ההסכמה והסתרת העותק.
 * 2. מחיקת העותק מהאחסון ומהגלריה. כשל → 502 STORAGE_DELETE_FAILED, והתמונה לא נמחקת (ניסיון חוזר ימשיך).
 * 3. Transaction: נעילה מחדש ומחיקת התמונה; הקובץ הפרטי נמחק מהאחסון אחר כך.
 */
export async function deleteEventPhoto(eventId: number, photoId: number, user: Express.AuthUser) {
  await assertEventAccess(eventId, user);
  const lockPhoto = async (tx: Prisma.TransactionClient) => {
    const [row] = await tx.$queryRaw<{ uploadedById: number | null }[]>`
      SELECT "uploadedById" FROM "EventPhotos" WHERE id = ${photoId} AND "eventId" = ${eventId} FOR UPDATE`;
    if (!row) throw photoNotFound();
    if (user.role !== 'Admin' && row.uploadedById !== user.id) {
      throw HttpError.forbidden('You can delete only photos you uploaded');
    }
  };

  const copies = await prisma.$transaction(async (tx) => {
    await lockPhoto(tx);
    return hideCopiesForRemoval(tx, [photoId]);
  });
  const failed = await removeGalleryCopies(copies);
  if (failed.length > 0) throw storageDeleteFailed(failed);

  const photo = await prisma.$transaction(async (tx) => {
    await lockPhoto(tx);
    const remaining = await tx.galleryItem.findMany({ where: { sourceEventPhotoId: photoId }, select: { id: true } });
    if (remaining.length > 0) throw copyCreatedMeanwhile(remaining.map((r) => r.id));
    return tx.eventPhoto.delete({ where: { id: photoId } });
  });
  await removeImagesSafely([photo.publicId], { access: accessOf(photo) });
}

/**
 * הסכמה / ביטול הסכמה לפרסום – בעלת האירוע בלבד (גם לתמונות שהמנהלת העלתה לאירוע שלה).
 * ביטול: ב-Transaction ההסכמה מבוטלת והעותק בגלריה מוסתר מיד; אחר כך העותק נמחק מהאחסון ומהגלריה.
 * הפעולה חוזרת על עצמה בבטחה (Idempotent) – ביטול חוזר מנסה שוב להסיר עותק שנשאר.
 */
export async function setPublishConsent(eventId: number, photoId: number, consent: boolean, user: Express.AuthUser) {
  const event = await assertEventAccess(eventId, user);
  if (event.userId !== user.id) throw HttpError.forbidden('Only the event owner can change the publish consent');

  const copy = await prisma.$transaction(async (tx) => {
    const { count } = await tx.eventPhoto.updateMany({ where: { id: photoId, eventId }, data: { publishConsent: consent } });
    if (count === 0) throw photoNotFound();
    if (consent) return null;
    const item = await tx.galleryItem.findUnique({ where: { sourceEventPhotoId: photoId }, select: { id: true, publicId: true, isPublished: true } });
    if (item?.isPublished) await tx.galleryItem.update({ where: { id: item.id }, data: { isPublished: false } });
    return item;
  });
  // כשל באחסון לא מכשיל את ביטול ההסכמה: העותק כבר מוסתר ולא יכול לחזור לפרסום, וביטול חוזר ינסה שוב
  if (copy) await removeGalleryCopies([copy]);

  const photo = await prisma.eventPhoto.findUniqueOrThrow({ where: { id: photoId }, include: galleryInclude });
  return toPhotoDto(photo, viewerOf(user), tryCreatePhotoLink(photo));
}

function copySourceOf(photo: EventPhoto): CopySource {
  if (photo.storageType === 'public') return { access: 'public', url: photo.url };
  if (!photo.publicId || !photo.url.startsWith(PRIVATE_URL_PREFIX)) {
    throw new Error(`Private photo ${photo.id} is missing its storage reference`);
  }
  return { access: 'authenticated', publicId: photo.publicId, format: photo.url.slice(PRIVATE_URL_PREFIX.length) };
}

/**
 * פרסום תמונת אירוע בגלריה – מנהלת בלבד, ורק עם הסכמה בתוקף של בעלת האירוע.
 * נוצר עותק ציבורי נפרד באחסון (קובץ המקור נשאר פרטי), ופריט גלריה שמקושר למקור ב-sourceEventPhotoId.
 * שורת התמונה ננעלת ב-Transaction וההסכמה נבדקת שוב, כך שביטול הסכמה מקביל לא "מפספס" את העותק;
 * האינדקס הייחודי על sourceEventPhotoId מונע פרסום כפול גם במקביל. כשל אחרי ההעתקה מוחק את העותק.
 */
export async function publishPhoto(eventId: number, photoId: number, input: PublishBodyInput) {
  const photo = await prisma.eventPhoto.findFirst({
    where: { id: photoId, eventId },
    include: { event: { select: { eventType: true } }, galleryItem: { select: { id: true } } },
  });
  if (!photo) throw photoNotFound();
  if (!photo.publishConsent) throw consentRequired();
  if (photo.galleryItem) throw alreadyPublished(photo.galleryItem.id);

  const copy = await getImageStorage().copyToPublic(copySourceOf(photo), 'gallery');
  let item: GalleryItem;
  try {
    item = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ publishConsent: boolean }[]>`
        SELECT "publishConsent" FROM "EventPhotos" WHERE id = ${photoId} AND "eventId" = ${eventId} FOR UPDATE`;
      if (!locked) throw photoNotFound();
      if (!locked.publishConsent) throw consentRequired();
      return tx.galleryItem.create({
        data: {
          title: input.title,
          category: input.category ?? photo.event.eventType,
          url: copy.url,
          publicId: copy.publicId,
          isPublished: input.isPublished ?? true,
          isFeatured: input.isFeatured ?? false,
          sortOrder: input.sortOrder ?? 0,
          sourceEventPhotoId: photoId,
        },
      });
    });
  } catch (error) {
    await removeImagesSafely([copy.publicId]);
    if (isUniqueViolation(error)) throw alreadyPublished();
    throw error;
  }
  return toAdminGalleryDto(item);
}

function consentRequired() {
  return new HttpError(409, 'PUBLISH_CONSENT_REQUIRED', 'The event owner has not given consent to publish this photo');
}

function alreadyPublished(galleryItemId?: number) {
  return new HttpError(
    409,
    'ALREADY_PUBLISHED',
    'This photo already has a copy in the gallery',
    galleryItemId !== undefined ? { galleryItemId } : undefined,
  );
}

/** תמונות אירוע למנהלת, למשל: publishConsent=true&inGallery=false – תמונות שממתינות לפרסום */
export async function listAdminPhotos(query: AdminPhotoQuery, user: Express.AuthUser) {
  const where: Prisma.EventPhotoWhereInput = {
    ...(query.eventId && { eventId: query.eventId }),
    ...(query.publishConsent !== undefined && { publishConsent: query.publishConsent }),
    ...(query.inGallery !== undefined && { galleryItem: query.inGallery ? { isNot: null } : { is: null } }),
  };
  const [totalItems, photos] = await prisma.$transaction([
    prisma.eventPhoto.count({ where }),
    prisma.eventPhoto.findMany({
      where,
      include: { ...galleryInclude, event: { select: { id: true, eventName: true, eventType: true, clientName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ]);
  const viewer = viewerOf(user);
  return toPage(
    photos.map(({ event, ...photo }) => ({ ...toPhotoDto(photo, viewer, tryCreatePhotoLink(photo)), event })),
    totalItems,
    query,
  );
}
