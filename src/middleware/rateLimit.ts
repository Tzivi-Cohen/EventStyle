import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const tooManyRequests = {
  error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
};

/** הגבלת קצב לנתיבי ההתחברות, ההרשמה והאימות – הגנה מניחוש סיסמאות וקודים */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooManyRequests,
  skip: () => env.isTest,
});

/** הגבלה כללית ל-API */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooManyRequests,
  skip: () => env.isTest,
});
