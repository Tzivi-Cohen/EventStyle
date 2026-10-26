import { z } from 'zod';
import { eventTypeSchema, paginationSchema } from './common.schema';

export const MAX_GALLERY_SORT_ORDER = 1000;

/** ערך בוליאני ב-Query String או בשדה טקסט של multipart: רק "true" או "false" */
const booleanString = (name: string) =>
  z.enum(['true', 'false'], { error: `${name} must be true or false` }).transform((value) => value === 'true');

const titleSchema = z.string().trim().min(2, 'Title must be at least 2 characters').max(120);
const sortOrderSchema = z
  .number({ error: 'sortOrder must be a number' })
  .int('sortOrder must be a whole number')
  .min(0)
  .max(MAX_GALLERY_SORT_ORDER);

/** גלריה ציבורית: רק פריטים מפורסמים. featured=true – רק תמונות מובילות */
export const galleryQuerySchema = z.object({
  category: eventTypeSchema.optional(),
  featured: booleanString('featured').optional(),
  ...paginationSchema.shape,
});

/** גלריה בממשק הניהול: כל הפריטים, כולל מוסתרים */
export const adminGalleryQuerySchema = z.object({
  category: eventTypeSchema.optional(),
  isPublished: booleanString('isPublished').optional(),
  isFeatured: booleanString('isFeatured').optional(),
  ...paginationSchema.shape,
});

/**
 * שדות הטקסט שנשלחים יחד עם הקובץ (multipart/form-data) – לכן הערכים מגיעים כמחרוזות.
 * isPublished (ברירת מחדל true), isFeatured (ברירת מחדל false) ו-sortOrder (ברירת מחדל 0) הם רשות.
 */
export const galleryBodySchema = z.strictObject({
  title: titleSchema,
  category: eventTypeSchema,
  isPublished: booleanString('isPublished').optional(),
  isFeatured: booleanString('isFeatured').optional(),
  sortOrder: z
    .string()
    .regex(/^\d+$/, 'sortOrder must be a whole number')
    .transform(Number)
    .pipe(sortOrderSchema)
    .optional(),
});

/** עריכת פריט גלריה (JSON): לפחות שדה אחד. הקובץ עצמו לא משתנה כאן */
export const galleryUpdateSchema = z
  .strictObject({
    title: titleSchema.optional(),
    category: eventTypeSchema.optional(),
    isPublished: z.boolean({ error: 'isPublished must be a boolean' }).optional(),
    isFeatured: z.boolean({ error: 'isFeatured must be a boolean' }).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    error: 'Send at least one field to update: title, category, isPublished, isFeatured or sortOrder',
  });

export type GalleryQuery = z.infer<typeof galleryQuerySchema>;
export type AdminGalleryQuery = z.infer<typeof adminGalleryQuerySchema>;
export type GalleryBodyInput = z.infer<typeof galleryBodySchema>;
export type GalleryUpdateInput = z.infer<typeof galleryUpdateSchema>;
