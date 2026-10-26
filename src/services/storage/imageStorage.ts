import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { env } from '../../config/env';
import { HttpError } from '../../errors/HttpError';
import { MAX_IMAGE_DIMENSION } from './imageProcessing';

export interface StoredImage {
  url: string;
  publicId: string | null;
}

/** ממשק כללי לאחסון תמונות – השרת לא שומר קבצים בדיסק המקומי */
export interface ImageStorage {
  upload(file: Express.Multer.File, folder: string): Promise<StoredImage>;
  remove(publicId: string): Promise<void>;
}

/**
 * הגדרות ההעלאה ל-Cloudinary – שכבת הגנה שנייה, אחרי העיבוד בשרת (sanitizeImage).
 * לפי תיעוד Upload API של Cloudinary:
 * - allowed_formats: קבצים בפורמט אחר נדחים.
 * - transformation: "incoming transformation" שרץ לפני השמירה בענן – כאן הגבלת גודל (crop: limit),
 *   והדגל force_strip: "clear all embedded metadata while applying an incoming transformation".
 * - public_id נוצר על ידי Cloudinary (שם הקובץ המקורי לא משמש).
 *
 * חשוב לעתיד: קישורי upload רגילים של Cloudinary פתוחים לכל מי שמחזיק בהם. תמונות פרטיות של לקוחות
 * (העלאה לאירוע, תמונות שממתינות לאישור) יחייבו הגנת גישה גם ברמת האחסון והקישור –
 * למשל type: 'authenticated' עם קישורים חתומים ובעלי תוקף – ולא רק בדיקת הרשאות ב-API.
 */
export const CLOUDINARY_UPLOAD_OPTIONS = {
  resource_type: 'image',
  allowed_formats: ['jpg', 'png', 'webp'],
  transformation: [{ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, crop: 'limit', flags: 'force_strip' }],
  use_filename: false,
  unique_filename: true,
} satisfies UploadApiOptions;

export class CloudinaryStorage implements ImageStorage {
  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  upload(file: Express.Multer.File, folder: string): Promise<StoredImage> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { ...CLOUDINARY_UPLOAD_OPTIONS, folder: `eventstyle/${folder}` },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
            console.error('Cloudinary upload failed:', error?.message);
            return reject(new HttpError(502, 'UPLOAD_FAILED', 'Image upload failed, please try again later'));
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(file.buffer);
    });
  }

  async remove(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  }
}

/** כשאין הגדרות Cloudinary: העלאה מחזירה 503, ושאר המערכת ממשיכה לעבוד */
export class DisabledStorage implements ImageStorage {
  async upload(): Promise<StoredImage> {
    throw new HttpError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Image storage is not configured on the server (set CLOUDINARY_* environment variables)',
    );
  }
  async remove(): Promise<void> {
    // אין מה למחוק – לא הועלו קבצים
  }
}

let currentStorage: ImageStorage | undefined;

export function getImageStorage(): ImageStorage {
  currentStorage ??= env.cloudinaryConfigured ? new CloudinaryStorage() : new DisabledStorage();
  return currentStorage;
}

/** מאפשר להחליף את שירות האחסון (בשימוש בבדיקות) */
export function setImageStorage(storage: ImageStorage): void {
  currentStorage = storage;
}

/** מחיקה "במאמץ הטוב ביותר" – כשל במחיקה מהענן לא מפיל את הבקשה */
export async function removeImagesSafely(publicIds: (string | null)[]): Promise<void> {
  const storage = getImageStorage();
  await Promise.all(
    publicIds
      .filter((id): id is string => Boolean(id))
      .map((id) =>
        storage.remove(id).catch((error: unknown) => {
          console.error(`Failed to remove image ${id} from storage:`, (error as Error).message);
        }),
      ),
  );
}
