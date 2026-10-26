import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { EVENT_TYPES } from '../schemas/common.schema';
import { toAdminGalleryDto, toGalleryDto } from '../utils/mappers';
import { toPage, toSkipTake } from '../utils/pagination';
import type { AdminGalleryQuery, GalleryBodyInput, GalleryQuery, GalleryUpdateInput } from '../schemas/gallery.schema';
import { getImageStorage, removeImagesSafely } from './storage/imageStorage';
import { removeGalleryCopies, storageDeleteFailed } from './photos.service';

/**
 * סדר הגלריה: sortOrder, ואז החדשים קודם (id לסדר יציב בין עמודים).
 * כש-sortOrder של כל הפריטים הוא 0 – זהה לסדר שהיה לפני ניהול הסדר.
 */
const galleryOrder = [
  { sortOrder: 'asc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.GalleryItemOrderByWithRelationInput[];

/** תנאי הבסיס לכל נתיב ציבורי: רק פריטים מפורסמים */
const PUBLISHED = { isPublished: true } satisfies Prisma.GalleryItemWhereInput;

/** הגלריה הציבורית – רק פריטים מפורסמים */
export async function listGallery(query: GalleryQuery) {
  const where: Prisma.GalleryItemWhereInput = {
    ...PUBLISHED,
    ...(query.category && { category: query.category }),
    ...(query.featured !== undefined && { isFeatured: query.featured }),
  };
  const [totalItems, items] = await prisma.$transaction([
    prisma.galleryItem.count({ where }),
    prisma.galleryItem.findMany({ where, orderBy: galleryOrder, ...toSkipTake(query) }),
  ]);
  return toPage(items.map(toGalleryDto), totalItems, query);
}

/**
 * סיכום הגלריות לדף הגלריות: לכל סוג אירוע – מספר הפריטים המפורסמים ותמונת שער.
 * תמונת השער: תמונה מובילה אם יש, אחרת הראשונה לפי סדר הגלריה. סוג ריק מקבל count=0 ו-cover=null.
 * פריטים מוסתרים לא נספרים ולא נבחרים כשער.
 */
export async function getGallerySummary() {
  return Promise.all(
    EVENT_TYPES.map(async (category) => {
      const where = { ...PUBLISHED, category } satisfies Prisma.GalleryItemWhereInput;
      const [count, cover] = await Promise.all([
        prisma.galleryItem.count({ where }),
        prisma.galleryItem.findFirst({ where, orderBy: [{ isFeatured: 'desc' }, ...galleryOrder] }),
      ]);
      return { category, count, cover: cover ? toGalleryDto(cover) : null };
    }),
  );
}

/** כל פריטי הגלריה למנהלת, כולל מוסתרים */
export async function listAdminGallery(query: AdminGalleryQuery) {
  const where: Prisma.GalleryItemWhereInput = {
    ...(query.category && { category: query.category }),
    ...(query.isPublished !== undefined && { isPublished: query.isPublished }),
    ...(query.isFeatured !== undefined && { isFeatured: query.isFeatured }),
  };
  const [totalItems, items] = await prisma.$transaction([
    prisma.galleryItem.count({ where }),
    prisma.galleryItem.findMany({ where, orderBy: galleryOrder, ...toSkipTake(query) }),
  ]);
  return toPage(items.map(toAdminGalleryDto), totalItems, query);
}

export async function addGalleryItem(file: Express.Multer.File, data: GalleryBodyInput) {
  const image = await getImageStorage().upload(file, 'gallery');
  try {
    const item = await prisma.galleryItem.create({
      data: {
        title: data.title,
        category: data.category,
        url: image.url,
        publicId: image.publicId,
        isPublished: data.isPublished ?? true,
        isFeatured: data.isFeatured ?? false,
        sortOrder: data.sortOrder ?? 0,
      },
    });
    return toAdminGalleryDto(item);
  } catch (error) {
    await removeImagesSafely([image.publicId]);
    throw error;
  }
}

/**
 * עריכת פרטי פריט (כותרת, סוג, פרסום, מובילה, סדר). שדה שלא נשלח לא משתנה, והקובץ לא משתנה.
 * עותק של תמונת לקוחה (sourceEventPhotoId) יכול לחזור לפרסום רק אם ההסכמה עדיין בתוקף.
 * שורת תמונת המקור ננעלת (FOR SHARE), כך שביטול הסכמה מקביל ממתין ומסתיר את הפריט אחרי העדכון.
 */
export async function updateGalleryItem(id: number, input: GalleryUpdateInput) {
  const item = await prisma.$transaction(async (tx) => {
    if (input.isPublished === true) {
      const current = await tx.galleryItem.findUnique({ where: { id }, select: { sourceEventPhotoId: true } });
      if (current?.sourceEventPhotoId) {
        const [source] = await tx.$queryRaw<{ publishConsent: boolean }[]>`
          SELECT "publishConsent" FROM "EventPhotos" WHERE id = ${current.sourceEventPhotoId} FOR SHARE`;
        if (!source?.publishConsent) {
          throw new HttpError(409, 'PUBLISH_CONSENT_REQUIRED', 'The event owner has not given consent to publish this photo');
        }
      }
    }
    const { count } = await tx.galleryItem.updateMany({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.isPublished !== undefined && { isPublished: input.isPublished }),
        ...(input.isFeatured !== undefined && { isFeatured: input.isFeatured }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      },
    });
    if (count === 0) throw HttpError.notFound('Gallery item not found');
    return tx.galleryItem.findUniqueOrThrow({ where: { id } });
  });
  return toAdminGalleryDto(item);
}

/**
 * מחיקה לצמיתות – כולל הקובץ ב-Cloudinary. להסתרה בלי מחיקה: PATCH עם isPublished=false.
 * פריט רגיל: ההתנהגות הקיימת (מחיקת הרשומה, ומחיקה מהאחסון במאמץ הטוב ביותר).
 * עותק של תמונת אירוע: מוסתר מיד, נמחק מהאחסון, ורק אז הרשומה נמחקת. כשל באחסון → 502 STORAGE_DELETE_FAILED,
 * והפריט נשאר מוסתר (לא עותק ציבורי פעיל בלי רשומה). תמונת המקור וההסכמה לא משתנות.
 */
export async function deleteGalleryItem(id: number) {
  const item = await prisma.galleryItem.findUnique({ where: { id } });
  if (!item) throw HttpError.notFound('Gallery item not found');
  if (item.sourceEventPhotoId === null) {
    await prisma.galleryItem.delete({ where: { id } });
    await removeImagesSafely([item.publicId]);
    return;
  }
  await prisma.galleryItem.updateMany({ where: { id }, data: { isPublished: false } });
  const failed = await removeGalleryCopies([item]);
  if (failed.length > 0) throw storageDeleteFailed(failed);
}
