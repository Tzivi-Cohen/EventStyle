import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { HttpError } from '../errors/HttpError';

export const MAX_FILE_SIZE_MB = 5;
export const MAX_FILES_PER_REQUEST = 10;
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * העלאת קבצים: נשמרים בזיכרון בלבד (לא בדיסק של השרת) ומועברים לשירות האחסון.
 * הגבלות: סוג קובץ, גודל קובץ ומספר קבצים.
 */
const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_REQUEST,
    fields: 10,
    fieldSize: 10 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new HttpError(
          415,
          'UNSUPPORTED_FILE_TYPE',
          `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        ),
      );
    }
  },
});

/**
 * בדיקת "חתימת הקובץ" (Magic Bytes) – מוודאת שהתוכן באמת תמונה,
 * ולא רק שהלקוח שלח Content-Type של תמונה.
 */
export function isRealImage(buffer: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return buffer.length > 8 && signature.every((byte, i) => buffer[i] === byte);
  }
  if (mimetype === 'image/webp') {
    return (
      buffer.length > 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}

function verifyFiles(files: Express.Multer.File[]) {
  for (const file of files) {
    if (!isRealImage(file.buffer, file.mimetype)) {
      throw new HttpError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        `File "${file.originalname}" is not a valid ${file.mimetype} image`,
      );
    }
  }
}

/** קובץ תמונה יחיד בשדה fieldName (חובה) */
export const uploadSingleImage =
  (fieldName: string) => (req: Request, res: Response, next: NextFunction) => {
    multerInstance.single(fieldName)(req, res, (err: unknown) => {
      if (err) return next(err);
      if (!req.file) return next(HttpError.badRequest(`Image file is required in field "${fieldName}"`));
      try {
        verifyFiles([req.file]);
        next();
      } catch (error) {
        next(error);
      }
    });
  };

/** עד MAX_FILES_PER_REQUEST תמונות בשדה fieldName (לפחות אחת) */
export const uploadManyImages =
  (fieldName: string) => (req: Request, res: Response, next: NextFunction) => {
    multerInstance.array(fieldName, MAX_FILES_PER_REQUEST)(req, res, (err: unknown) => {
      if (err) return next(err);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        return next(HttpError.badRequest(`At least one image file is required in field "${fieldName}"`));
      }
      try {
        verifyFiles(files);
        next();
      } catch (error) {
        next(error);
      }
    });
  };
