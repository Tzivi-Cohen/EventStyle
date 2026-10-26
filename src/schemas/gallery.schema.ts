import { z } from 'zod';
import { eventTypeSchema, paginationSchema } from './common.schema';

export const galleryQuerySchema = z.object({
  category: eventTypeSchema.optional(),
  ...paginationSchema.shape,
});

export type GalleryQuery = z.infer<typeof galleryQuerySchema>;

/** שדות הטקסט שנשלחים יחד עם הקובץ (multipart/form-data) */
export const galleryBodySchema = z.strictObject({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(120),
  category: eventTypeSchema,
});
