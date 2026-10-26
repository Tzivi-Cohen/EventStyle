import { z } from 'zod';
import { emailSchema } from './common.schema';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{6,18}$/, 'Phone must contain 7-19 digits (may start with +)');

export const registerSchema = z.strictObject({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: emailSchema,
  phone: phoneSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one digit'),
});

/** התחברות / הרשמה עם Google: רק ה-ID Token. תפקיד או פרטים אחרים לא מתקבלים מהלקוח */
export const googleLoginSchema = z.strictObject({
  idToken: z.string({ error: 'idToken is required' }).trim().min(1, 'idToken is required').max(4096),
});

export const ADDRESS_MAX_LENGTH = 200;

/** כתובת: עד 200 תווים אחרי הסרת רווחים. מחרוזת ריקה או null מוחקות את הכתובת (נשמר null) */
const addressSchema = z
  .string({ error: 'Address must be a string or null' })
  .trim()
  .max(ADDRESS_MAX_LENGTH, `Address must be at most ${ADDRESS_MAX_LENGTH} characters`)
  .nullable()
  .transform((value) => (value ? value : null));

/**
 * עריכת פרופיל: רק שם, טלפון וכתובת.
 * strictObject – ניסיון לשלוח role, email, googleId, emailVerified, id וכו' נדחה עם 400.
 */
export const updateProfileSchema = z
  .strictObject({
    fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100).optional(),
    phone: phoneSchema.optional(),
    address: addressSchema.optional(),
  })
  .refine((data) => data.fullName !== undefined || data.phone !== undefined || data.address !== undefined, {
    error: 'Send at least one field to update: fullName, phone or address',
  });

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72),
});

export const verifyEmailSchema = z.strictObject({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

export const resendCodeSchema = z.strictObject({
  email: emailSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
