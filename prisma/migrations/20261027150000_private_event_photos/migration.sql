-- תמונות פרטיות של לקוחות לפי אירוע (שלב 6, משימה 2)
-- שינוי שמוסיף בלבד: שום טבלה, עמודה או רשומה לא נמחקים, ומזהים קיימים לא משתנים.
-- כל תמונות האירוע הקיימות מקבלות storageType = 'public' (המשמעות הנוכחית שלהן), publishConsent = false,
-- ו-NULL ב-uploadedById וב-contentHash. כל פריטי הגלריה הקיימים מקבלים NULL ב-sourceEventPhotoId.

-- CreateEnum
CREATE TYPE "PhotoStorageType" AS ENUM ('public', 'authenticated');

-- AlterTable
ALTER TABLE "EventPhotos" ADD COLUMN     "contentHash" CHAR(64),
ADD COLUMN     "publishConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storageType" "PhotoStorageType" NOT NULL DEFAULT 'public',
ADD COLUMN     "uploadedById" INTEGER;

-- AlterTable
ALTER TABLE "GalleryItems" ADD COLUMN     "sourceEventPhotoId" INTEGER;

-- CreateIndex
CREATE INDEX "EventPhotos_uploadedById_idx" ON "EventPhotos"("uploadedById");

-- מניעת העלאה כפולה של אותו קובץ לאותו אירוע. ב-PostgreSQL ערכי NULL אינם נחשבים זהים,
-- ולכן תמונות ישנות (contentHash = NULL) לא מתנגשות זו בזו
-- CreateIndex
CREATE UNIQUE INDEX "EventPhotos_eventId_contentHash_key" ON "EventPhotos"("eventId", "contentHash");

-- תמונת מקור מתפרסמת בגלריה פעם אחת לכל היותר (גם בבקשות מקבילות)
-- CreateIndex
CREATE UNIQUE INDEX "GalleryItems_sourceEventPhotoId_key" ON "GalleryItems"("sourceEventPhotoId");

-- מחיקת משתמש לא מוחקת את התמונות שהעלה – רק מאפסת את uploadedById
-- AddForeignKey
ALTER TABLE "EventPhotos" ADD CONSTRAINT "EventPhotos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- מחיקת תמונת המקור (או האירוע, שמוחק את תמונותיו ב-CASCADE) לא מוחקת את פריט הגלריה –
-- רק מאפסת את sourceEventPhotoId. מדיניות מחיקה אחרת תמומש בקוד, רק לאחר אישור
-- AddForeignKey
ALTER TABLE "GalleryItems" ADD CONSTRAINT "GalleryItems_sourceEventPhotoId_fkey" FOREIGN KEY ("sourceEventPhotoId") REFERENCES "EventPhotos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- אילוץ תקינות: contentHash הוא SHA-256 בהקסדצימלי (64 תווים קטנים) או NULL
ALTER TABLE "EventPhotos" ADD CONSTRAINT "EventPhotos_contentHash_sha256_chk" CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[0-9a-f]{64}$');
