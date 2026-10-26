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

export function toPhotoDto(photo: EventPhoto) {
  return {
    id: photo.id,
    eventId: photo.eventId,
    url: photo.url,
    publicId: photo.publicId,
    createdAt: photo.createdAt.toISOString(),
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

/** פריט גלריה בממשק הניהול: גם מצב הפרסום ותאריך העדכון */
export function toAdminGalleryDto(item: GalleryItem) {
  return {
    ...toGalleryDto(item),
    isPublished: item.isPublished,
    updatedAt: item.updatedAt.toISOString(),
  };
}

type EventWithRelations = Event & {
  package?: Pick<Package, 'id' | 'name'> | null;
  photos?: EventPhoto[];
  _count?: { photos: number };
};

/**
 * @param includeNotes true רק עבור מנהלת. לקוח לעולם לא מקבל את notes.
 */
export function toEventDto(event: EventWithRelations, includeNotes: boolean) {
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
    userId: event.userId,
    ...(event._count && { photoCount: event._count.photos }),
    ...(event.photos && { photos: event.photos.map(toPhotoDto) }),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
