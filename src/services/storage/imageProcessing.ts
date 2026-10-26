import sharp from 'sharp';
import { HttpError } from '../../errors/HttpError';

/** הצלע הארוכה ביותר של תמונה שנשמרת (בפיקסלים). תמונה קטנה יותר לא מוגדלת */
export const MAX_IMAGE_DIMENSION = 2500;
/** הגנה מ"פצצת פענוח": תמונה קטנה בקובץ אבל עצומה בפיקסלים נדחית לפני פענוח */
export const MAX_INPUT_PIXELS = 40_000_000;

/**
 * עיבוד מחדש של כל תמונה לפני שהיא נשמרת באחסון (sharp):
 * 1. סיבוב לפי כיוון ה-EXIF (rotate) – כך שתמונות מהטלפון לא נשמרות על הצד.
 * 2. הקטנה עד MAX_IMAGE_DIMENSION.
 * 3. קידוד מחדש באותו פורמט. sharp לא מעתיק מטא-דאטה לפלט כברירת מחדל,
 *    ולכן EXIF (כולל מיקום GPS), IPTC ו-XMP מוסרים. ההתנהגות נבדקת בבדיקות האוטומטיות.
 * קידוד מחדש גם מנטרל תוכן שמוסתר בקובץ אחרי נתוני התמונה.
 */
export async function sanitizeImage(
  file: Express.Multer.File,
  options: { maxInputPixels?: number } = {},
): Promise<Express.Multer.File> {
  try {
    const pipeline = sharp(file.buffer, { limitInputPixels: options.maxInputPixels ?? MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: 'inside', withoutEnlargement: true });

    const encoded =
      file.mimetype === 'image/png'
        ? pipeline.png({ compressionLevel: 9 })
        : file.mimetype === 'image/webp'
          ? pipeline.webp({ quality: 85 })
          : pipeline.jpeg({ quality: 85, mozjpeg: true });

    const buffer = await encoded.toBuffer();
    return { ...file, buffer, size: buffer.length };
  } catch (error) {
    if (/pixel limit/i.test((error as Error).message)) {
      throw new HttpError(413, 'FILE_TOO_LARGE', `Image "${file.originalname}" has too many pixels`);
    }
    throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', `File "${file.originalname}" could not be processed as an image`);
  }
}
