import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { EVENT_TYPES } from '../schemas/common.schema';
import { toAdminGalleryDto, toGalleryDto } from '../utils/mappers';
import { toPage, toSkipTake } from '../utils/pagination';
import type { AdminGalleryQuery, GalleryBodyInput, GalleryQuery, GalleryUpdateInput } from '../schemas/gallery.schema';
import { getImageStorage, removeImagesSafely } from './storage/imageStorage';

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

/** עריכת פרטי פריט (כותרת, סוג, פרסום, מובילה, סדר). שדה שלא נשלח לא משתנה, והקובץ לא משתנה */
export async function updateGalleryItem(id: number, input: GalleryUpdateInput) {
  const { count } = await prisma.galleryItem.updateMany({
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
  return toAdminGalleryDto(await prisma.galleryItem.findUniqueOrThrow({ where: { id } }));
}

/** מחיקה לצמיתות – כולל הקובץ ב-Cloudinary. להסתרה בלי מחיקה: PATCH עם isPublished=false */
export async function deleteGalleryItem(id: number) {
  const item = await prisma.galleryItem.findUnique({ where: { id } });
  if (!item) throw HttpError.notFound('Gallery item not found');
  await prisma.galleryItem.delete({ where: { id } });
  await removeImagesSafely([item.publicId]);
}
