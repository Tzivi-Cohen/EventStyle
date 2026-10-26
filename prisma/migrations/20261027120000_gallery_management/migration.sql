-- ניהול גלריה: פרסום / הסתרה, תמונות מובילות וסדר הצגה
-- שינוי שמוסיף בלבד: שום שורה או קובץ לא נמחקים. כל הפריטים הקיימים נשארים מפורסמים, לא מובילים,
-- עם sortOrder = 0 – כך שהסדר הציבורי (sortOrder, ואז החדשים קודם) זהה לסדר הקיים.

-- AlterTable
ALTER TABLE "GalleryItems" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- updatedAt מנוהל על ידי Prisma (@updatedAt). ברירת המחדל נדרשה רק כדי למלא את השורות הקיימות
ALTER TABLE "GalleryItems" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "GalleryItems_category_isPublished_sortOrder_idx" ON "GalleryItems"("category", "isPublished", "sortOrder");

-- אילוצי תקינות
ALTER TABLE "GalleryItems" ADD CONSTRAINT "GalleryItems_sortOrder_chk" CHECK ("sortOrder" >= 0);
ALTER TABLE "GalleryItems" ADD CONSTRAINT "GalleryItems_title_not_blank_chk" CHECK (length(btrim("title")) > 0);
