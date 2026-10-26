import type { PaginationQuery } from '../schemas/common.schema';

/** הפיכת page / limit ל-skip / take של Prisma */
export function toSkipTake({ page, limit }: PaginationQuery) {
  return { skip: (page - 1) * limit, take: limit };
}

/**
 * מבנה תשובה אחיד לרשימות:
 * { data: [...], pagination: { page, limit, totalItems, totalPages } }
 * עמוד שאחרי הסוף (או רשימה ריקה) מחזיר data ריק – לא שגיאה.
 */
export function toPage<T>(data: T[], totalItems: number, { page, limit }: PaginationQuery) {
  return {
    data,
    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
  };
}
