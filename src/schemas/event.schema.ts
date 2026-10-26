import { z } from 'zod';
import { emailSchema, eventStatusSchema, eventTypeSchema, paginationSchema } from './common.schema';

/** תאריך בפורמט YYYY-MM-DD שהוא גם תאריך קיים בלוח השנה */
const dateOnlySchema = z.iso.date({ error: 'eventDate must be a valid date in format YYYY-MM-DD' });

/** שדה טקסט אופציונלי: מחרוזת ריקה נשמרת כ-null */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalUrl = z
  .union([z.literal(''), z.url({ protocol: /^https?$/, error: 'Must be a valid http(s) URL' }).max(500)])
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * גוף יצירה / עריכה של אירוע.
 * strictObject – שדות לא מוכרים (כמו userId) נדחים עם 400.
 * userId נקבע אך ורק על ידי השרת, לפי clientEmail של משתמש מאומת.
 */
export const eventBodySchema = z.strictObject({
  eventName: z.string().trim().min(2, 'Event name must be at least 2 characters').max(120),
  clientName: z.string().trim().min(2, 'Client name must be at least 2 characters').max(100),
  clientEmail: emailSchema,
  eventType: eventTypeSchema,
  eventDate: dateOnlySchema,
  location: z.string().trim().min(2, 'Location must be at least 2 characters').max(200),
  packageId: z.number({ error: 'packageId must be a number' }).int().positive(),
  themeColor: z.string().trim().min(1, 'Theme color is required').max(30),
  guestCount: z
    .number({ error: 'guestCount must be a number' })
    .int('guestCount must be a whole number')
    .positive('guestCount must be greater than 0')
    .max(100_000),
  budget: z
    .number({ error: 'budget must be a number' })
    .nonnegative('budget cannot be negative')
    .max(9_999_999_999.99)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'budget can have at most 2 decimal places'),
  status: eventStatusSchema.optional(),
  coverImageUrl: optionalUrl,
  notes: optionalText(2000),
});

export const eventStatusBodySchema = z.strictObject({
  status: eventStatusSchema,
});

export const SORT_FIELDS = ['eventDate', 'budget', 'clientName'] as const;

export const eventListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  eventType: eventTypeSchema.optional(),
  status: eventStatusSchema.optional(),
  packageId: z.coerce.number({ error: 'packageId must be a number' }).int().positive().optional(),
  sortBy: z.enum(SORT_FIELDS, { error: `sortBy must be one of: ${SORT_FIELDS.join(', ')}` }).default('eventDate'),
  sortDir: z.enum(['asc', 'desc'], { error: 'sortDir must be asc or desc' }).default('desc'),
  ...paginationSchema.shape,
});

export const photoParamsSchema = z.object({
  id: z.coerce.number().int().positive({ error: 'id must be a positive integer' }),
  photoId: z.coerce.number().int().positive({ error: 'photoId must be a positive integer' }),
});

export type EventBodyInput = z.infer<typeof eventBodySchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
