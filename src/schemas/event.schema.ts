import { z } from 'zod';
import { emailSchema, eventStatusSchema, eventTypeSchema, operationalStatusSchema, paginationSchema } from './common.schema';

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

/**
 * שדה טקסט שהמנהלת יכולה לשלוח או להשמיט: undefined = לא לגעת בערך הקיים,
 * מחרוזת ריקה או null = מחיקה. כך עריכה בטופס הניהול לא מוחקת את מה שהלקוחה כתבה בבקשה.
 */
const keepableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));

const optionalUrl = z
  .union([z.literal(''), z.url({ protocol: /^https?$/, error: 'Must be a valid http(s) URL' }).max(500)])
  .nullish()
  .transform((value) => (value ? value : null));

/** בקשות פתוחות (Pending) לכל לקוחה */
export const MAX_PENDING_REQUESTS = 5;

export const DESCRIPTION_MAX = 2000;
export const CLIENT_NOTES_MAX = 1000;
export const REJECTION_REASON_MAX = 500;

const eventNameSchema = z.string().trim().min(2, 'Event name must be at least 2 characters').max(120);

/** שדות פרטי האירוע – משותפים לטופס המנהלת ולבקשת הלקוחה */
const eventDetailsShape = {
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
};

/**
 * גוף יצירה / עריכה של אירוע (מנהלת).
 * strictObject – שדות לא מוכרים (כמו userId) נדחים עם 400.
 * userId נקבע אך ורק על ידי השרת, לפי clientEmail של משתמש מאומת.
 */
export const eventBodySchema = z.strictObject({
  eventName: eventNameSchema,
  clientName: z.string().trim().min(2, 'Client name must be at least 2 characters').max(100),
  clientEmail: emailSchema,
  eventType: eventTypeSchema,
  eventDate: dateOnlySchema,
  ...eventDetailsShape,
  // רק סטטוס תפעולי. Pending / Rejected נקבעים רק דרך בקשת לקוחה ו-/approve, /reject
  status: operationalStatusSchema.optional(),
  coverImageUrl: optionalUrl,
  notes: optionalText(2000),
  description: keepableText(DESCRIPTION_MAX),
  clientNotes: keepableText(CLIENT_NOTES_MAX),
});

export const eventStatusBodySchema = z.strictObject({
  status: operationalStatusSchema,
});

/** היום בישראל, בפורמט YYYY-MM-DD */
function todayInIsrael() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/**
 * בקשת לקוחה לעיצוב אירוע – Allowlist מפורשת: רק השדות האלה.
 * strictObject – status, userId, clientEmail, notes, coverImageUrl וכל שדה אחר נדחים עם 400.
 * הבעלים, השם והאימייל נקבעים בשרת לפי המשתמשת המחוברת.
 */
export const eventRequestBodySchema = z.strictObject({
  eventName: eventNameSchema,
  eventType: eventTypeSchema,
  eventDate: dateOnlySchema.refine((date) => date >= todayInIsrael(), 'eventDate cannot be in the past'),
  ...eventDetailsShape,
  description: z.string().trim().min(10, 'Description must be at least 10 characters').max(DESCRIPTION_MAX),
  clientNotes: optionalText(CLIENT_NOTES_MAX),
});

/** עריכת בקשה ממתינה: אותה Allowlist, וכל השדות אופציונליים – לפחות שדה אחד */
export const eventRequestUpdateSchema = eventRequestBodySchema
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    error: 'Send at least one field to update',
  });

/** דחיית בקשה: סיבה רשות, גלויה ללקוחה */
export const rejectRequestBodySchema = z.strictObject({
  reason: optionalText(REJECTION_REASON_MAX),
});

export const SORT_FIELDS = ['eventDate', 'budget', 'clientName', 'eventName', 'createdAt'] as const;

const budgetFilter = (name: string) =>
  z.coerce.number({ error: `${name} must be a number` }).nonnegative(`${name} cannot be negative`).optional();

/** חיפוש, סינון ומיון – משותף לרשימת המנהלת (GET /events) ולרשימת הלקוחה (GET /events/my) */
export const eventListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    eventType: eventTypeSchema.optional(),
    status: eventStatusSchema.optional(),
    packageId: z.coerce.number({ error: 'packageId must be a number' }).int().positive().optional(),
    minBudget: budgetFilter('minBudget'),
    maxBudget: budgetFilter('maxBudget'),
    sortBy: z.enum(SORT_FIELDS, { error: `sortBy must be one of: ${SORT_FIELDS.join(', ')}` }).default('eventDate'),
    sortDir: z.enum(['asc', 'desc'], { error: 'sortDir must be asc or desc' }).default('desc'),
    ...paginationSchema.shape,
  })
  .refine((q) => q.minBudget === undefined || q.maxBudget === undefined || q.minBudget <= q.maxBudget, {
    error: 'minBudget cannot be greater than maxBudget',
    path: ['minBudget'],
  });

export const photoParamsSchema = z.object({
  id: z.coerce.number().int().positive({ error: 'id must be a positive integer' }),
  photoId: z.coerce.number().int().positive({ error: 'photoId must be a positive integer' }),
});

export type EventBodyInput = z.infer<typeof eventBodySchema>;
export type EventRequestInput = z.infer<typeof eventRequestBodySchema>;
export type EventRequestUpdate = z.infer<typeof eventRequestUpdateSchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
