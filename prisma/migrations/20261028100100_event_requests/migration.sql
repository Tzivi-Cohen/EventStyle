-- בקשות לקוחות לעיצוב אירוע – שדות חדשים, כולם NULL ובלי ערך ברירת מחדל:
-- שורות קיימות לא נכתבות מחדש ולא משתנות.

-- AlterTable
ALTER TABLE "Events" ADD COLUMN     "clientNotes" VARCHAR(1000),
ADD COLUMN     "description" VARCHAR(2000),
ADD COLUMN     "rejectionReason" VARCHAR(500),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" INTEGER;

-- CreateIndex
CREATE INDEX "Events_reviewedById_idx" ON "Events"("reviewedById");

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- מניעת בקשה כפולה: לכל לקוחה בקשה ממתינה אחת בלבד לאותו שם אירוע (בלי הבדל אותיות) באותו תאריך.
-- השירות בודק זאת גם בקוד (כולל אירועים שכבר אושרו); האינדקס הוא ההגנה האחרונה גם בבקשות מקבילות.
-- Prisma לא מתארת אינדקס חלקי ב-schema.prisma – יש לוודא שהוא לא מוסר ב-Migrations עתידיים
CREATE UNIQUE INDEX "Events_pending_request_key" ON "Events"("userId", lower("eventName"), "eventDate") WHERE "status" = 'Pending';
