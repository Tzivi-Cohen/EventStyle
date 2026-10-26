import { z } from 'zod';
import { eventTypeSchema, paginationSchema } from './common.schema';
import { booleanString, sortOrderSchema, titleSchema } from './gallery.schema';

/** הסכמת בעלת האירוע לפרסום תמונה בגלריה (true = מסכימה, false = ביטול ההסכמה) */
export const consentBodySchema = z.strictObject({
  publishConsent: z.boolean({ error: 'publishConsent must be a boolean' }),
});

/**
 * פרסום תמונת אירוע בגלריה (מנהלת). נוצר עותק ציבורי נפרד – קובץ המקור הפרטי לא נחשף.
 * category – ברירת מחדל: סוג האירוע. isPublished – ברירת מחדל true.
 */
export const publishBodySchema = z.strictObject({
  title: titleSchema,
  category: eventTypeSchema.optional(),
  isPublished: z.boolean({ error: 'isPublished must be a boolean' }).optional(),
  isFeatured: z.boolean({ error: 'isFeatured must be a boolean' }).optional(),
  sortOrder: sortOrderSchema.optional(),
});

/** תמונות אירוע בממשק הניהול – למשל תמונות שקיבלו הסכמה ועדיין לא פורסמו */
export const adminPhotoQuerySchema = z.object({
  eventId: z.coerce.number({ error: 'eventId must be a number' }).int().positive({ error: 'eventId must be a positive integer' }).optional(),
  publishConsent: booleanString('publishConsent').optional(),
  inGallery: booleanString('inGallery').optional(),
  ...paginationSchema.shape,
});

export type ConsentBodyInput = z.infer<typeof consentBodySchema>;
export type PublishBodyInput = z.infer<typeof publishBodySchema>;
export type AdminPhotoQuery = z.infer<typeof adminPhotoQuerySchema>;
