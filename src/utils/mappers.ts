import type { Event, EventPhoto, GalleryItem, Package, Prisma, User } from '@prisma/client';

/**
 * הפיכת רשומות מסד הנתונים לאובייקטי JSON שנשלחים ללקוח.
 * כאן מוודאים שלעולם לא נשלחים passwordHash, קודי אימות או הערות פנימיות ללקוח.
 */

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const decimalToNumber = (value: Prisma.Decimal): number => value.toNumber();

export function toPublicUser(
  user: Pick<
    User,
    'id' | 'fullName' | 'email' | 'phone' | 'address' | 'role' | 'emailVerified' | 'googleId' | 'createdAt'
  >,
) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    address: user.address,
    role: user.role,
    emailVerified: user.emailVerified,
    // רק האם החשבון מקושר ל-Google – המזהה עצמו לא נשלח
    googleLinked: user.googleId !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** חבילה במחירון הציבורי. eventType=null פירושו חבילה כללית שמתאימה לכל סוג אירוע */
export function toPackageDto(pkg: Package) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    price: decimalToNumber(pkg.price),
    features: pkg.features,
    imageUrl: pkg.imageUrl,
    eventType: pkg.eventType,
    sortOrder: pkg.sortOrder,
  };
}

/** חבילה בממשק הניהול: גם מצב הארכיון וכמה הזמנות משתמשות בה */
export function toAdminPackageDto(pkg: Package & { _count?: { events: number } }) {
  return {
    ...toPackageDto(pkg),
    isActive: pkg.isActive,
    ...(pkg._count && { eventCount: pkg._count.events }),
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

/** מי צופה בתמונה: קובע אילו שדות מוחזרים ואם מותר לו למחוק */
export interface PhotoViewer {
  id: number;
  isAdmin: boolean;
}

/** קישור לצפייה: בתמונה ציבורית ישנה – הקישור הקבוע (expiresAt=null); בתמונה פרטית – קישור זמני */
export interface PhotoLink {
  url: string;
  expiresAt: Date | null;
}

export type PhotoWithGallery = EventPhoto & { galleryItem?: Pick<GalleryItem, 'id' | 'isPublished'> | null };

/**
 * תמונת אירוע. ללקוחה לא נשלחים publicId, סוג האחסון או קישור קבוע לתמונה פרטית –
 * רק קישור זמני שנוצר אחרי בדיקת ההרשאות (link). link=null כשאי אפשר ליצור קישור כרגע.
 */
export function toPhotoDto(photo: PhotoWithGallery, viewer: PhotoViewer, link: PhotoLink | null) {
  const dto = {
    id: photo.id,
    eventId: photo.eventId,
    url: link?.url ?? null,
    urlExpiresAt: link?.expiresAt ? link.expiresAt.toISOString() : null,
    isPrivate: photo.storageType === 'authenticated',
    publishConsent: photo.publishConsent,
    publishedInGallery: Boolean(photo.galleryItem?.isPublished),
    uploadedByMe: photo.uploadedById === viewer.id,
    canDelete: viewer.isAdmin || photo.uploadedById === viewer.id,
    createdAt: photo.createdAt.toISOString(),
  };
  if (!viewer.isAdmin) return dto;
  return {
    ...dto,
    publicId: photo.publicId,
    storageType: photo.storageType,
    uploadedById: photo.uploadedById,
    galleryItemId: photo.galleryItem?.id ?? null,
  };
}

export function toGalleryDto(item: GalleryItem) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    url: item.url,
    publicId: item.publicId,
    isFeatured: item.isFeatured,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
  };
}

/** פריט גלריה בממשק הניהול: גם מצב הפרסום, תאריך העדכון ותמונת האירוע שממנה נוצר העותק (אם יש) */
export function toAdminGalleryDto(item: GalleryItem) {
  return {
    ...toGalleryDto(item),
    isPublished: item.isPublished,
    sourceEventPhotoId: item.sourceEventPhotoId,
    updatedAt: item.updatedAt.toISOString(),
  };
}

type EventWithRelations = Event & {
  package?: Pick<Package, 'id' | 'name'> | null;
  _count?: { photos: number };
};

/**
 * @param includeNotes true רק עבור מנהלת. לקוח לעולם לא מקבל את notes.
 * @param photos התמונות אחרי המרה (toPhotoDto) – רק באירוע בודד
 */
export function toEventDto(event: EventWithRelations, includeNotes: boolean, photos?: ReturnType<typeof toPhotoDto>[]) {
  return {
    id: event.id,
    eventName: event.eventName,
    clientName: event.clientName,
    clientEmail: event.clientEmail,
    eventType: event.eventType,
    eventDate: toDateOnly(event.eventDate),
    location: event.location,
    packageId: event.packageId,
    ...(event.package && { package: { id: event.package.id, name: event.package.name } }),
    themeColor: event.themeColor,
    guestCount: event.guestCount,
    budget: decimalToNumber(event.budget),
    status: event.status,
    coverImageUrl: event.coverImageUrl,
    ...(includeNotes && { notes: event.notes }),
    // פרטי הבקשה – גלויים גם ללקוחה
    description: event.description,
    clientNotes: event.clientNotes,
    rejectionReason: event.rejectionReason,
    reviewedAt: event.reviewedAt?.toISOString() ?? null,
    ...(includeNotes && { reviewedById: event.reviewedById }),
    userId: event.userId,
    ...(event._count && { photoCount: event._count.photos }),
    ...(photos && { photos }),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
