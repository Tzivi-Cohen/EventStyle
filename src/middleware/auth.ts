import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../auth/jwt';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';

/**
 * Authentication – בודק Bearer Token ומצרף את המשתמש לבקשה (req.user).
 * המשתמש נטען מחדש ממסד הנתונים, כך שתפקיד או מחיקה מתעדכנים מיד.
 * אין Token / Token לא תקין → 401.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw HttpError.unauthorized('Missing Bearer token');
  }

  const userId = verifyAccessToken(header.slice('Bearer '.length).trim());
  if (!userId) {
    throw HttpError.unauthorized('Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, emailVerified: true },
  });
  if (!user) {
    throw HttpError.unauthorized('User no longer exists');
  }

  req.user = user;
  next();
};

/**
 * Authorization – בדיקת תפקיד בצד השרת.
 * משתמש מחובר ללא התפקיד הנדרש → 403.
 */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw HttpError.unauthorized();
    if (!roles.includes(req.user.role)) throw HttpError.forbidden();
    next();
  };

export const requireAdmin = requireRole('Admin');
