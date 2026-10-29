import 'dotenv/config';
import { z } from 'zod';

/**
 * קריאה ובדיקה של משתני הסביבה בעליית השרת.
 * אם חסר משתנה חיוני – השרת לא יעלה, עם הודעה ברורה.
 */
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must look like 15m, 2h or 1d')
      .default('2h'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    // אין אימות אימייל בקוד ואין שליחת מיילים. EMAIL_PROVIDER ישן בקובץ ההגדרות פשוט מתעלמים ממנו

    CLOUDINARY_CLOUD_NAME: z.preprocess(emptyToUndefined, z.string().optional()),
    CLOUDINARY_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    CLOUDINARY_API_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),

    // Client ID של אפליקציית Web ב-Google Cloud Console (אינו סוד). בלעדיו התחברות Google מחזירה 503
    GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.CORS_ORIGIN.split(',').some((o) => o.trim() === '*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN must list explicit origins in production (no "*")',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

/** הדפדפן שולח Origin בלי / בסוף – כך כתובת שהוגדרה עם / (למשל https://site.onrender.com/) עדיין מותרת */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: parseCorsOrigins(raw.CORS_ORIGIN),
  cloudinaryConfigured: Boolean(
    raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET,
  ),
};

export type Env = typeof env;
