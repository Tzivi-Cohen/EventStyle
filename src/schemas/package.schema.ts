import { z } from 'zod';
import { eventTypeSchema } from './common.schema';

export const MAX_FEATURES = 20;
export const MAX_SORT_ORDER = 1000;

/**
 * גוף יצירה / עריכה של חבילה (מנהלת בלבד).
 * strictObject – שדות לא מוכרים נדחים עם 400.
 * eventType הוא שדה חובה בגוף הבקשה: סוג אירוע, או null לחבילה כללית –
 * כך שעריכה מלאה (PUT) לא הופכת חבילה לכללית רק כי השדה נשכח.
 */
export const packageBodySchema = z.strictObject({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  description: z.string().trim().min(2, 'Description must be at least 2 characters').max(500),
  price: z
    .number({ error: 'price must be a number' })
    .nonnegative('price cannot be negative')
    .max(99_999_999.99)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'price can have at most 2 decimal places'),
  features: z
    .array(z.string().trim().min(1, 'Feature cannot be empty').max(100), { error: 'features must be an array of strings' })
    .min(1, 'At least one feature is required')
    .max(MAX_FEATURES, `At most ${MAX_FEATURES} features`),
  imageUrl: z.url({ protocol: /^https$/, error: 'imageUrl must be a valid https URL' }).max(500),
  eventType: eventTypeSchema.nullable(),
  /** ביצירה: ברירת מחדל true. בעריכה: אם לא נשלח – לא משתנה (true מחזיר מהארכיון) */
  isActive: z.boolean({ error: 'isActive must be a boolean' }).optional(),
  /** ביצירה: ברירת מחדל 0. בעריכה: אם לא נשלח – לא משתנה */
  sortOrder: z
    .number({ error: 'sortOrder must be a number' })
    .int('sortOrder must be a whole number')
    .min(0)
    .max(MAX_SORT_ORDER)
    .optional(),
});

/** מחירון ציבורי: סינון רשות לפי סוג אירוע (מוחזרות גם החבילות הכלליות) */
export const publicPackagesQuerySchema = z.object({
  eventType: eventTypeSchema.optional(),
});

/** רשימת ניהול: eventType=general מחזיר רק חבילות כלליות; isActive=true/false לסינון לפי ארכיון */
export const adminPackagesQuerySchema = z.object({
  eventType: z.union([eventTypeSchema, z.literal('general')]).optional(),
  isActive: z
    .enum(['true', 'false'], { error: 'isActive must be true or false' })
    .transform((value) => value === 'true')
    .optional(),
});

export type PackageBodyInput = z.infer<typeof packageBodySchema>;
export type PublicPackagesQuery = z.infer<typeof publicPackagesQuerySchema>;
export type AdminPackagesQuery = z.infer<typeof adminPackagesQuerySchema>;
