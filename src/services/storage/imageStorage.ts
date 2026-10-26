import { v2 as cloudinary, type ConfigOptions, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { env } from '../../config/env';
import { HttpError } from '../../errors/HttpError';
import { MAX_IMAGE_DIMENSION } from './imageProcessing';

/**
 * סוג האחסון של קובץ:
 * - public: קישור ציבורי קבוע (Cloudinary type "upload") – הגלריה הציבורית ותמונות קיימות.
 * - authenticated: קובץ פרטי (Cloudinary type "authenticated") – נגיש רק דרך קישור חתום.
 */
export type ImageAccess = 'public' | 'authenticated';

/** תמונה ציבורית שהועלתה: הקישור הקבוע מיועד לשמירה ולהצגה */
export interface StoredImage {
  url: string;
  publicId: string | null;
}

/**
 * תמונה פרטית שהועלתה. אין כאן שדה url בכוונה: הקישור ש-Cloudinary מחזיר בהעלאת authenticated
 * הוא קישור חתום שלא פג תוקפו, ולכן אסור לשמור או להחזיר אותו. לצפייה יוצרים קישור זמני
 * (getPrivateDownloadUrl) רק אחרי בדיקת הרשאות.
 */
export interface PrivateStoredImage {
  access: 'authenticated';
  publicId: string;
  /** הפורמט שנשמר (jpg / png / webp) – נדרש ליצירת קישור הורדה */
  format: string;
}

/** קישור זמני לקובץ פרטי – נוצר בשרת בלבד */
export interface PrivateDownloadLink {
  url: string;
  expiresAt: Date;
}

export interface RemoveOptions {
  /** ברירת מחדל: public */
  access?: ImageAccess;
}

/** תוקף ברירת המחדל של קישור הורדה לקובץ פרטי */
export const PRIVATE_DOWNLOAD_TTL_SECONDS = 10 * 60;
/** התוקף המרבי שמותר לבקש */
export const MAX_PRIVATE_DOWNLOAD_TTL_SECONDS = 60 * 60;
const PRIVATE_FORMATS = ['jpg', 'png', 'webp'] as const;

/** ממשק כללי לאחסון תמונות – השרת לא שומר קבצים בדיסק המקומי */
export interface ImageStorage {
  /** העלאה ציבורית (ברירת המחדל – ההתנהגות הקיימת) */
  upload(file: Express.Multer.File, folder: string, options?: { access?: 'public' }): Promise<StoredImage>;
  /** העלאה פרטית (authenticated) – מחזירה מזהה בלבד, בלי קישור */
  upload(file: Express.Multer.File, folder: string, options: { access: 'authenticated' }): Promise<PrivateStoredImage>;
  /** קישור הורדה זמני לקובץ פרטי (ברירת מחדל: 10 דקות) */
  getPrivateDownloadUrl(publicId: string, format: string, options?: { expiresInSeconds?: number }): PrivateDownloadLink;
  /** מחיקה לפי סוג האחסון, כולל ביטול העותקים ב-CDN */
  remove(publicId: string, options?: RemoveOptions): Promise<void>;
}

/**
 * הגדרות ההעלאה ל-Cloudinary – שכבת הגנה שנייה, אחרי העיבוד בשרת (sanitizeImage).
 * לפי תיעוד Upload API של Cloudinary:
 * - allowed_formats: קבצים בפורמט אחר נדחים.
 * - transformation: "incoming transformation" שרץ לפני השמירה בענן – כאן הגבלת גודל (crop: limit),
 *   והדגל force_strip: "clear all embedded metadata while applying an incoming transformation".
 * - public_id נוצר על ידי Cloudinary (שם הקובץ המקורי לא משמש).
 *
 * קבצים ציבוריים (type "upload") פתוחים לכל מי שמחזיק בקישור. תמונות פרטיות של לקוחות מועלות
 * כ-authenticated, ונגישות רק דרך קישור הורדה חתום וקצר-תוקף שהשרת יוצר אחרי בדיקת הרשאות.
 */
export const CLOUDINARY_UPLOAD_OPTIONS = {
  resource_type: 'image',
  allowed_formats: ['jpg', 'png', 'webp'],
  transformation: [{ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, crop: 'limit', flags: 'force_strip' }],
  use_filename: false,
  unique_filename: true,
} satisfies UploadApiOptions;

const uploadFailed = () => new HttpError(502, 'UPLOAD_FAILED', 'Image upload failed, please try again later');
const cloudinaryType = (access: ImageAccess) => (access === 'authenticated' ? 'authenticated' : 'upload');

function validateTtl(expiresInSeconds: number) {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_PRIVATE_DOWNLOAD_TTL_SECONDS) {
    throw new Error(`expiresInSeconds must be a whole number between 1 and ${MAX_PRIVATE_DOWNLOAD_TTL_SECONDS}`);
  }
}

export class CloudinaryStorage implements ImageStorage {
  constructor(
    credentials: Pick<ConfigOptions, 'cloud_name' | 'api_key' | 'api_secret'> = {
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    },
  ) {
    cloudinary.config({ ...credentials, secure: true });
  }

  upload(file: Express.Multer.File, folder: string, options?: { access?: 'public' }): Promise<StoredImage>;
  upload(file: Express.Multer.File, folder: string, options: { access: 'authenticated' }): Promise<PrivateStoredImage>;
  upload(file: Express.Multer.File, folder: string, options: { access?: ImageAccess } = {}): Promise<StoredImage | PrivateStoredImage> {
    const access = options.access ?? 'public';
    // בהעלאה ציבורית נשלחות בדיוק ההגדרות הקיימות; בפרטית מתווסף רק type: authenticated
    const uploadOptions: UploadApiOptions = {
      ...CLOUDINARY_UPLOAD_OPTIONS,
      folder: `eventstyle/${folder}`,
      ...(access === 'authenticated' && { type: 'authenticated' }),
    };

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result?: UploadApiResponse) => {
        if (error || !result) {
          console.error('Cloudinary upload failed:', error?.message);
          return reject(uploadFailed());
        }
        if (access === 'public') {
          return resolve({ url: result.secure_url, publicId: result.public_id });
        }
        // הגנה: קובץ שאמור להיות פרטי חייב להישמר כ-authenticated. אחרת – מוחקים ונכשלים, ולא חושפים אותו
        if (result.type !== 'authenticated') {
          console.error('Cloudinary stored a private image with an unexpected type:', result.type);
          void this.remove(result.public_id, { access: result.type === 'upload' ? 'public' : 'authenticated' }).catch(() => undefined);
          return reject(uploadFailed());
        }
        // result.secure_url (קישור חתום קבוע) לא מוחזר בכוונה
        resolve({ access: 'authenticated', publicId: result.public_id, format: result.format });
      });
      stream.end(file.buffer);
    });
  }

  /**
   * קישור הורדה חתום וזמני (private_download_url) לקובץ authenticated.
   * נחתם בשרת עם ה-API Secret; הקישור עצמו מכיל רק את ה-API Key (מזהה ציבורי), חתימה ותאריך תפוגה.
   * אחרי התפוגה Cloudinary מחזיר 401, ושינוי של expires_at בלי חתימה חדשה נדחה.
   */
  getPrivateDownloadUrl(publicId: string, format: string, options: { expiresInSeconds?: number } = {}): PrivateDownloadLink {
    if (!publicId) throw new Error('publicId is required');
    if (!(PRIVATE_FORMATS as readonly string[]).includes(format)) {
      throw new Error(`format must be one of: ${PRIVATE_FORMATS.join(', ')}`);
    }
    const expiresInSeconds = options.expiresInSeconds ?? PRIVATE_DOWNLOAD_TTL_SECONDS;
    validateTtl(expiresInSeconds);
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const url = cloudinary.utils.private_download_url(publicId, format, {
      type: 'authenticated',
      resource_type: 'image',
      expires_at: expiresAtSeconds,
    });
    return { url, expiresAt: new Date(expiresAtSeconds * 1000) };
  }

  /** מחיקה לפי סוג האחסון. invalidate: true מבטל גם את העותקים השמורים ב-CDN */
  async remove(publicId: string, options: RemoveOptions = {}): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      type: cloudinaryType(options.access ?? 'public'),
      invalidate: true,
    });
  }
}

const storageNotConfigured = () =>
  new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'Image storage is not configured on the server (set CLOUDINARY_* environment variables)');

/** כשאין הגדרות Cloudinary: העלאה וקישורי הורדה מחזירים 503, ושאר המערכת ממשיכה לעבוד */
export class DisabledStorage implements ImageStorage {
  upload(file: Express.Multer.File, folder: string, options?: { access?: 'public' }): Promise<StoredImage>;
  upload(file: Express.Multer.File, folder: string, options: { access: 'authenticated' }): Promise<PrivateStoredImage>;
  async upload(): Promise<StoredImage | PrivateStoredImage> {
    throw storageNotConfigured();
  }
  getPrivateDownloadUrl(): PrivateDownloadLink {
    throw storageNotConfigured();
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

/**
 * מחיקה "במאמץ הטוב ביותר" – כשל במחיקה מהענן לא מפיל את הבקשה.
 * כל הקבצים ברשימה באותו סוג אחסון (ברירת מחדל: public – ההתנהגות הקיימת).
 */
export async function removeImagesSafely(publicIds: (string | null)[], options: RemoveOptions = {}): Promise<void> {
  const storage = getImageStorage();
  await Promise.all(
    publicIds
      .filter((id): id is string => Boolean(id))
      .map((id) =>
        storage.remove(id, options).catch((error: unknown) => {
          console.error(`Failed to remove image ${id} from storage:`, (error as Error).message);
        }),
      ),
  );
}
