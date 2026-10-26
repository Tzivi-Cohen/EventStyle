import supertest from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/auth/password';
import { signAccessToken } from '../src/auth/jwt';
import { setMailer, type Mailer } from '../src/services/email/mailer';
import { setImageStorage, type ImageStorage, type StoredImage } from '../src/services/storage/imageStorage';

export { prisma };

/** שירות מיילים מדומה – שומר את הקודים שנשלחו במקום לשלוח */
export class FakeMailer implements Mailer {
  sent: { email: string; code: string }[] = [];
  async sendVerificationCode(to: { email: string }, code: string) {
    this.sent.push({ email: to.email, code });
  }
  lastCodeFor(email: string) {
    return [...this.sent].reverse().find((m) => m.email === email)?.code;
  }
}

/** אחסון תמונות מדומה – לא פונה ל-Cloudinary */
export class FakeStorage implements ImageStorage {
  uploads = 0;
  removed: string[] = [];
  async upload(_file: Express.Multer.File, folder: string): Promise<StoredImage> {
    this.uploads += 1;
    return { url: `https://cdn.test/${folder}/${this.uploads}.png`, publicId: `${folder}/${this.uploads}` };
  }
  async remove(publicId: string) {
    this.removed.push(publicId);
  }
}

export const mailer = new FakeMailer();
export const storage = new FakeStorage();
setMailer(mailer);
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
  mailer.sent = [];
  storage.uploads = 0;
  storage.removed = [];
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
