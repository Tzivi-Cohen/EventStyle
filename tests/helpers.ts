import supertest from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/auth/password';
import { signAccessToken } from '../src/auth/jwt';
import { HttpError } from '../src/errors/HttpError';
import {
  PRIVATE_DOWNLOAD_TTL_SECONDS,
  setImageStorage,
  type CopySource,
  type ImageAccess,
  type ImageStorage,
  type PrivateDownloadLink,
  type PrivateStoredImage,
  type StoredImage,
} from '../src/services/storage/imageStorage';

export { prisma };

/** אחסון תמונות מדומה – לא פונה ל-Cloudinary */
export class FakeStorage implements ImageStorage {
  uploads = 0;
  removed: string[] = [];
  /** סוג האחסון של כל מחיקה (לפי הסדר) */
  removedWith: { publicId: string; access: ImageAccess }[] = [];
  /** הקבצים שהגיעו לשלב האחסון (אחרי כל הבדיקות והעיבוד) */
  files: Express.Multer.File[] = [];
  /** סוג האחסון של כל העלאה (לפי הסדר) */
  uploadAccess: ImageAccess[] = [];
  /** מקורות ההעתקה לעותק ציבורי (לפי הסדר) */
  copies: CopySource[] = [];
  /** הדמיית כשלים: ההעלאה ה-n (1 = הראשונה) נכשלת, העתקה נכשלת, מחיקה נכשלת */
  failUploadAt: number | null = null;
  failCopy = false;
  failRemove = false;
  /** מחיקה נכשלת רק לקבצים האלה */
  failRemoveIds = new Set<string>();

  reset() {
    this.uploads = 0;
    this.removed = [];
    this.removedWith = [];
    this.files = [];
    this.uploadAccess = [];
    this.copies = [];
    this.failUploadAt = null;
    this.failCopy = false;
    this.failRemove = false;
    this.failRemoveIds = new Set();
  }

  upload(file: Express.Multer.File, folder: string, options?: { access?: 'public' }): Promise<StoredImage>;
  upload(file: Express.Multer.File, folder: string, options: { access: 'authenticated' }): Promise<PrivateStoredImage>;
  async upload(file: Express.Multer.File, folder: string, options: { access?: ImageAccess } = {}): Promise<StoredImage | PrivateStoredImage> {
    const access = options.access ?? 'public';
    this.uploads += 1;
    if (this.failUploadAt === this.uploads) {
      throw new HttpError(502, 'UPLOAD_FAILED', 'Image upload failed, please try again later');
    }
    this.files.push(file);
    this.uploadAccess.push(access);
    if (access === 'authenticated') {
      return { access, publicId: `${folder}/private-${this.uploads}`, format: 'png' };
    }
    return { url: `https://cdn.test/${folder}/${this.uploads}.png`, publicId: `${folder}/${this.uploads}` };
  }

  getPrivateDownloadUrl(publicId: string, format: string, options: { expiresInSeconds?: number } = {}): PrivateDownloadLink {
    const expiresAt = new Date(Date.now() + (options.expiresInSeconds ?? PRIVATE_DOWNLOAD_TTL_SECONDS) * 1000);
    return { url: `https://private.test/${publicId}.${format}?expires_at=${Math.floor(expiresAt.getTime() / 1000)}`, expiresAt };
  }

  async copyToPublic(source: CopySource, folder: string): Promise<StoredImage> {
    if (this.failCopy) throw new HttpError(502, 'UPLOAD_FAILED', 'Image upload failed, please try again later');
    this.copies.push(source);
    this.uploads += 1;
    return { url: `https://cdn.test/${folder}/copy-${this.uploads}.png`, publicId: `${folder}/copy-${this.uploads}` };
  }

  async remove(publicId: string, options: { access?: ImageAccess } = {}) {
    if (this.failRemove || this.failRemoveIds.has(publicId)) throw new Error('Simulated storage outage');
    this.removed.push(publicId);
    this.removedWith.push({ publicId, access: options.access ?? 'public' });
  }
}

export const storage = new FakeStorage();
setImageStorage(storage);

export const api = supertest(createApp());

/** PNG תקין קטן (חתימה אמיתית) לבדיקות העלאה */
export const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "EventPhotos", "Events", "GalleryItems", "Users", "Packages" RESTART IDENTITY CASCADE',
  );
  storage.reset();
  setImageStorage(storage);

  await prisma.package.createMany({
    data: [
      { name: 'Basic', description: 'Basic package', price: 1200, features: ['Table'], imageUrl: 'https://img.test/basic.jpg' },
      { name: 'Premium', description: 'Premium package', price: 2800, features: ['Table', 'Balloons'], imageUrl: 'https://img.test/premium.jpg' },
      { name: 'Luxury', description: 'Luxury package', price: 5500, features: ['Concept', 'Flowers'], imageUrl: 'https://img.test/luxury.jpg' },
    ],
  });
}

export async function createUser(options: {
  email: string;
  role?: Role;
  verified?: boolean;
  password?: string;
  fullName?: string;
}) {
  const user = await prisma.user.create({
    data: {
      fullName: options.fullName ?? 'Test User',
      email: options.email,
      phone: '050-1111111',
      passwordHash: await hashPassword(options.password ?? 'Password1'),
      role: options.role ?? 'Client',
      emailVerified: options.verified ?? true,
    },
  });
  return { user, token: signAccessToken(user), auth: `Bearer ${signAccessToken(user)}` };
}

export const createAdmin = () => createUser({ email: 'admin@test.com', role: 'Admin', fullName: 'Admin' });

export function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    eventName: 'Birthday Party',
    clientName: 'Noa Levi',
    clientEmail: 'noa@test.com',
    eventType: 'Birthday',
    eventDate: '2026-12-15',
    location: 'Tel Aviv',
    packageId: 1,
    themeColor: '#F4C2C2',
    guestCount: 50,
    budget: 3000,
    notes: 'internal note',
    ...overrides,
  };
}
