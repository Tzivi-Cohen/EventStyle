import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../errors/HttpError';
import { MAX_FILE_SIZE_MB } from './upload';

/** 404 לנתיב שלא קיים */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

/**
 * טיפול אחיד בשגיאות. פורמט התשובה תמיד:
 * { "error": { "code": "...", "message": "...", "details": ... } }
 * פרטים פנימיים (Stack, SQL, סודות) לעולם לא נשלחים ללקוח.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, ...(details !== undefined && { details }) } });

  if (err instanceof HttpError) {
    return send(err.status, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return send(
      400,
      'VALIDATION_ERROR',
      'Validation failed',
      err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return send(413, 'FILE_TOO_LARGE', `File is too large (max ${MAX_FILE_SIZE_MB}MB)`);
    }
    return send(400, 'VALIDATION_ERROR', `Upload error: ${err.message}`);
  }

  // JSON לא תקין בגוף הבקשה
  if (err?.type === 'entity.parse.failed') {
    return send(400, 'VALIDATION_ERROR', 'Request body contains invalid JSON');
  }
  if (err?.type === 'entity.too.large') {
    return send(413, 'FILE_TOO_LARGE', 'Request body is too large');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(409, 'CONFLICT', 'A record with this value already exists');
    if (err.code === 'P2025') return send(404, 'NOT_FOUND', 'Resource not found');
    if (err.code === 'P2003') return send(409, 'CONFLICT', 'Operation violates a relation constraint');
  }

  console.error('Unhandled error:', err);
  return send(500, 'INTERNAL_ERROR', 'Internal server error');
};
