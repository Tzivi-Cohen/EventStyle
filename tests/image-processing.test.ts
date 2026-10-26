import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_DIMENSION, sanitizeImage } from '../src/services/storage/imageProcessing';
import { CLOUDINARY_UPLOAD_OPTIONS, CloudinaryStorage } from '../src/services/storage/imageStorage';
import { api, createAdmin, eventBody, prisma, resetDatabase, storage } from './helpers';

const SECRET = 'SECRET-OWNER-NAME-1234';

/** תמונה עם מטא-דאטה רגיש: EXIF (כולל מיקום GPS וכיוון) ותוכן מזהה */
async function imageWithMetadata(format: 'jpeg' | 'png' | 'webp', size = { width: 40, height: 20 }, orientation?: number) {
  let pipeline = sharp({ create: { ...size, channels: 3, background: '#f4c2c2' } }).withExif({
    IFD0: { Copyright: SECRET, ImageDescription: SECRET, Artist: SECRET },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '32/1 4/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '34/1 46/1 50/1' },
  });
  if (orientation) pipeline = pipeline.withMetadata({ orientation });
  return pipeline.toFormat(format).toBuffer();
}

function multerFile(buffer: Buffer, mimetype: string, originalname = 'photo'): Express.Multer.File {
  return { buffer, mimetype, originalname, size: buffer.length, fieldname: 'image' } as Express.Multer.File;
}

describe('sanitizeImage – metadata removal (verified, not assumed)', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('%s: EXIF / GPS are present before and fully removed after', async (format, mimetype) => {
    const input = await imageWithMetadata(format);
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined(); // מוודאים שהבדיקה באמת מתחילה עם מטא-דאטה
    expect(input.includes(SECRET)).toBe(true);

    const output = (await sanitizeImage(multerFile(input, mimetype))).buffer;
    const after = await sharp(output).metadata();
    expect(after.format).toBe(format); // אותו פורמט
    expect(after.exif).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(output.includes(SECRET)).toBe(false);
    expect(output.includes(Buffer.from('GPS'))).toBe(false);
  });

  it('applies the EXIF orientation before removing it (phone photos are not saved sideways)', async () => {
    const input = await imageWithMetadata('jpeg', { width: 40, height: 20 }, 6); // 6 = סיבוב 90°
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const after = await sharp((await sanitizeImage(multerFile(input, 'image/jpeg'))).buffer).metadata();
    expect([after.width, after.height]).toEqual([20, 40]);
    expect(after.orientation).toBeUndefined();
  });

  it(`limits the longest side to ${MAX_IMAGE_DIMENSION}px and never enlarges small images`, async () => {
    const big = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const bigAfter = await sharp((await sanitizeImage(multerFile(big, 'image/png'))).buffer).metadata();
    expect([bigAfter.width, bigAfter.height]).toEqual([MAX_IMAGE_DIMENSION, 1000]);

    const small = await imageWithMetadata('png');
    const smallAfter = await sharp((await sanitizeImage(multerFile(small, 'image/png'))).buffer).metadata();
    expect([smallAfter.width, smallAfter.height]).toEqual([40, 20]);
  });

  it('rejects an image with too many pixels (413) before decoding it', async () => {
    const input = await imageWithMetadata('png', { width: 200, height: 200 });
    await expect(sanitizeImage(multerFile(input, 'image/png'), { maxInputPixels: 10_000 })).rejects.toMatchObject({
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
  });

  it('rejects a file with a valid signature but broken image data (415)', async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    await expect(sanitizeImage(multerFile(broken, 'image/jpeg'))).rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
  });
});

describe('Uploads through the API are sanitized before they reach storage', () => {
  let adminAuth: string;
  beforeEach(async () => {
    await resetDatabase();
    adminAuth = (await createAdmin()).auth;
  });
  afterAll(() => prisma.$disconnect());

  it('gallery upload: the stored file has no EXIF / GPS', async () => {
    const input = await imageWithMetadata('jpeg');
    const res = await api.post('/api/gallery').set('Authorization', adminAuth).field('title', 'With GPS').field('category', 'Birthday').attach('image', input, 'gps.jpg');
    expect(res.status).toBe(201);

    expect(storage.files).toHaveLength(1);
    const stored = storage.files[0]!.buffer;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(SECRET)).toBe(false);
  });

  it('event photo upload (admin): every stored file has no EXIF / GPS', async () => {
    const event = await api.post('/api/events').set('Authorization', adminAuth).send(eventBody()).expect(201);
    const res = await api
      .post(`/api/events/${event.body.id}/photos`)
      .set('Authorization', adminAuth)
      .attach('photos', await imageWithMetadata('jpeg'), 'a.jpg')
      .attach('photos', await imageWithMetadata('webp'), 'b.webp');
    expect(res.status).toBe(201);
    expect(storage.files).toHaveLength(2);
    for (const file of storage.files) {
      expect((await sharp(file.buffer).metadata()).exif).toBeUndefined();
      expect(file.buffer.includes(SECRET)).toBe(false);
    }
  });

  it('a broken image is rejected (415) and nothing is uploaded or saved', async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    const res = await api.post('/api/gallery').set('Authorization', adminAuth).field('title', 'Broken').field('category', 'Brit').attach('image', broken, { filename: 'b.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(415);
    expect(storage.uploads).toBe(0);
    expect(await prisma.galleryItem.count()).toBe(0);
  });
});

describe('Cloudinary upload options (second layer)', () => {
  afterAll(() => vi.restoreAllMocks());

  it('match the Cloudinary Upload API documentation: allowed formats, size limit, force_strip, no original filename', () => {
    expect(CLOUDINARY_UPLOAD_OPTIONS).toEqual({
      resource_type: 'image',
      allowed_formats: ['jpg', 'png', 'webp'],
      transformation: [{ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, crop: 'limit', flags: 'force_strip' }],
      use_filename: false,
      unique_filename: true,
    });
  });

  it('CloudinaryStorage sends these options and the sanitized buffer to upload_stream', async () => {
    let captured: { options?: Record<string, unknown>; data?: Buffer } = {};
    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((options: Record<string, unknown>, callback: (e: unknown, r: unknown) => void) => {
      captured.options = options;
      return {
        end: (data: Buffer) => {
          captured.data = data;
          callback(undefined, { secure_url: 'https://res.cloudinary.test/x.jpg', public_id: 'eventstyle/gallery/x' });
        },
      };
    }) as never);

    const file = multerFile(Buffer.from('sanitized-bytes'), 'image/jpeg');
    const stored = await new CloudinaryStorage().upload(file, 'gallery');

    expect(stored).toEqual({ url: 'https://res.cloudinary.test/x.jpg', publicId: 'eventstyle/gallery/x' });
    expect(captured.options).toEqual({ ...CLOUDINARY_UPLOAD_OPTIONS, folder: 'eventstyle/gallery' });
    expect(captured.data).toBe(file.buffer);
    captured = {};
  });
});
