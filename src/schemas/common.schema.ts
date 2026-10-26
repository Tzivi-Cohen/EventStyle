import { z } from 'zod';

export const EVENT_TYPES = ['Birthday', 'BatMitzvah', 'Brit', 'Corporate', 'Private'] as const;
export const EVENT_STATUSES = ['New', 'Planning', 'Preparing', 'Ready', 'Completed'] as const;

/** נרמול אימייל: הסרת רווחים והמרה לאותיות קטנות, ואז בדיקת תקינות */
export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Invalid email address' }).max(254));

export const idParamSchema = z.object({
  id: z.coerce.number({ error: 'id must be a number' }).int().positive({ error: 'id must be a positive integer' }),
});

export const eventTypeSchema = z.enum(EVENT_TYPES, {
  error: `Must be one of: ${EVENT_TYPES.join(', ')}`,
});

export const eventStatusSchema = z.enum(EVENT_STATUSES, {
  error: `Must be one of: ${EVENT_STATUSES.join(', ')}`,
});

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

/** חלוקה לעמודים: page מתחיל ב-1, limit = מספר פריטים בעמוד (עד MAX_PAGE_SIZE) */
export const paginationSchema = z.object({
  page: z.coerce
    .number({ error: 'page must be a number' })
    .int('page must be a whole number')
    .min(1, 'page must be at least 1')
    .max(100_000)
    .default(1),
  limit: z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(MAX_PAGE_SIZE, `limit must be at most ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;
