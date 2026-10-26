import { Prisma, type EventType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { toAdminPackageDto, toPackageDto } from '../utils/mappers';
import type { AdminPackagesQuery, PackageBodyInput, PublicPackagesQuery } from '../schemas/package.schema';

/** סדר המחירון: חבילות הסוג לפני הכלליות, ואז לפי sortOrder, מחיר ו-id (סדר יציב) */
const packageOrder = [
  { eventType: { sort: 'asc', nulls: 'last' } },
  { sortOrder: 'asc' },
  { price: 'asc' },
  { id: 'asc' },
] satisfies Prisma.PackageOrderByWithRelationInput[];

/**
 * המחירון הציבורי: רק חבילות פעילות.
 * עם eventType – החבילות של הסוג, ואחריהן החבילות הכלליות (שמתאימות לכל סוג).
 */
export async function listPackages(query: PublicPackagesQuery = {}) {
  const packages = await prisma.package.findMany({
    where: {
      isActive: true,
      ...(query.eventType && { OR: [{ eventType: query.eventType }, { eventType: null }] }),
    },
    orderBy: packageOrder,
  });
  return packages.map(toPackageDto);
}

/** כל החבילות למנהלת, כולל ארכיון, עם מספר ההזמנות שמשתמשות בכל חבילה */
export async function listAdminPackages(query: AdminPackagesQuery) {
  const packages = await prisma.package.findMany({
    where: {
      ...(query.eventType !== undefined && { eventType: query.eventType === 'general' ? null : query.eventType }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
    },
    include: { _count: { select: { events: true } } },
    orderBy: packageOrder,
  });
  return packages.map(toAdminPackageDto);
}

/** שם כפול באותו סוג (או בין החבילות הכלליות) → 409 עם הודעה ברורה */
function rethrowNameConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw HttpError.conflict('A package with this name already exists for this event type');
  }
  throw error;
}

export async function createPackage(input: PackageBodyInput) {
  try {
    const pkg = await prisma.package.create({
      data: { ...input, isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 0 },
      include: { _count: { select: { events: true } } },
    });
    return toAdminPackageDto(pkg);
  } catch (error) {
    rethrowNameConflict(error);
  }
}

/**
 * עריכה מלאה של חבילה. מחיר שמשתנה לא משנה הזמנות קיימות (המחיר לא נשמר בהזמנה).
 *
 * שינוי eventType מותר רק אם לא נוצר חוסר התאמה עם הזמנות קיימות:
 * מעבר לחבילה כללית (null) תמיד מותר; מעבר לסוג מסוים מותר רק אם כל ההזמנות של החבילה הן מאותו סוג.
 * שורת החבילה ננעלת (FOR UPDATE) עד סוף ה-Transaction, ויצירה / עריכה של הזמנה נועלת אותה ב-FOR SHARE –
 * כך שבקשות מקבילות לא יכולות ליצור חוסר התאמה.
 */
export async function updatePackage(id: number, input: PackageBodyInput) {
  try {
    const pkg = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Packages" WHERE id = ${id} FOR UPDATE`;
      if (locked.length === 0) throw HttpError.notFound('Package not found');

      if (input.eventType !== null) {
        const mismatched = await tx.event.count({
          where: { packageId: id, eventType: { not: input.eventType } },
        });
        if (mismatched > 0) {
          throw new HttpError(
            409,
            'CONFLICT',
            `Cannot change the event type: ${mismatched} existing event(s) of another type use this package`,
            { conflictingEvents: mismatched },
          );
        }
      }

      return tx.package.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          price: input.price,
          features: input.features,
          imageUrl: input.imageUrl,
          eventType: input.eventType,
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
        include: { _count: { select: { events: true } } },
      });
    });
    return toAdminPackageDto(pkg);
  } catch (error) {
    rethrowNameConflict(error);
  }
}

/**
 * "מחיקה" = העברה לארכיון בלבד. החבילה נעלמת מהמחירון הציבורי ולא ניתן לבחור בה להזמנות חדשות,
 * אבל הזמנות קיימות ממשיכות להפנות אליה. אין מחיקה פיזית (גם ה-Foreign Key מוגדר RESTRICT).
 */
export async function archivePackage(id: number) {
  const { count } = await prisma.package.updateMany({ where: { id }, data: { isActive: false } });
  if (count === 0) throw HttpError.notFound('Package not found');
}

/**
 * בדיקת חבילה בהזמנה (בתוך Transaction): החבילה קיימת, פעילה, ומסוג ההזמנה או כללית.
 * חבילה בארכיון מותרת רק אם ההזמנה כבר משויכת אליה (עריכה של הזמנה ישנה).
 * השורה ננעלת ב-FOR SHARE, כדי ששינוי סוג או ארכיון במקביל ימתינו לסיום הבדיקה.
 */
export async function assertPackageAllowedForEvent(
  tx: Prisma.TransactionClient,
  packageId: number,
  eventType: EventType,
  currentPackageId?: number,
) {
  const [pkg] = await tx.$queryRaw<{ eventType: EventType | null; isActive: boolean }[]>`
    SELECT "eventType", "isActive" FROM "Packages" WHERE id = ${packageId} FOR SHARE`;
  const invalid = (message: string) => HttpError.badRequest('Validation failed', [{ field: 'packageId', message }]);

  if (!pkg) throw invalid('Package does not exist');
  if (!pkg.isActive && packageId !== currentPackageId) {
    throw invalid('Package is archived and cannot be selected');
  }
  if (pkg.eventType !== null && pkg.eventType !== eventType) {
    throw invalid(`Package is for ${pkg.eventType} events and does not match eventType ${eventType}`);
  }
}
