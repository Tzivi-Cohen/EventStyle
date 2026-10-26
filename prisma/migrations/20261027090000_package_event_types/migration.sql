-- מחירונים לפי סוג אירוע
-- שינוי שמוסיף בלבד: שום שורה לא נמחקת. החבילות הקיימות נשארות כלליות (eventType = NULL) ופעילות,
-- והזמנות קיימות לא משתנות.

-- AlterTable
ALTER TABLE "Packages" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "eventType" "EventType",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- updatedAt מנוהל על ידי Prisma (@updatedAt). ברירת המחדל נדרשה רק כדי למלא את השורות הקיימות
ALTER TABLE "Packages" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- השם ייחודי בתוך סוג אירוע (במקום ייחודי בכל הטבלה)
-- DropIndex
DROP INDEX "Packages_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Packages_eventType_name_key" ON "Packages"("eventType", "name");

-- ב-PostgreSQL ערכי NULL אינם נחשבים זהים באינדקס ייחודי, ולכן לחבילות הכלליות נדרש אינדקס חלקי נפרד.
-- Prisma לא מתארת אינדקס חלקי ב-schema.prisma – יש לוודא שהוא לא מוסר ב-Migrations עתידיים
CREATE UNIQUE INDEX "Packages_general_name_key" ON "Packages"("name") WHERE "eventType" IS NULL;

-- CreateIndex
CREATE INDEX "Packages_eventType_isActive_idx" ON "Packages"("eventType", "isActive");

-- אילוצי תקינות
ALTER TABLE "Packages" ADD CONSTRAINT "Packages_sortOrder_chk" CHECK ("sortOrder" >= 0);
ALTER TABLE "Packages" ADD CONSTRAINT "Packages_name_not_blank_chk" CHECK (length(btrim("name")) > 0);
