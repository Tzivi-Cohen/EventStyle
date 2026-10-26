import crypto from 'node:crypto';
import { env } from '../config/env';

export { VERIFICATION } from '../config/verification';

/** קוד אקראי בן 6 ספרות, מבוסס מחולל אקראיות קריפטוגרפי */
export function generateVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * הקוד לא נשמר כטקסט גלוי – נשמר רק HMAC-SHA256 שלו,
 * עם מפתח סודי שנגזר מ-JWT_SECRET ומקושר לכתובת האימייל.
 */
export function hashVerificationCode(email: string, code: string): string {
  return crypto
    .createHmac('sha256', `email-verification:${env.JWT_SECRET}`)
    .update(`${email}:${code}`)
    .digest('hex');
}

/** השוואה בזמן קבוע (מונעת התקפות תזמון) */
export function verificationCodeMatches(email: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashVerificationCode(email, code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
