-- התחברות עם Google + עריכת פרופיל
-- שינוי שמוסיף בלבד: לא נמחקים נתונים, משתמשים או סיסמאות קיימים.

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "googleId" VARCHAR(255),
ALTER COLUMN "phone" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Users_googleId_key" ON "Users"("googleId");

-- לכל משתמש חייבת להיות לפחות דרך התחברות אחת: סיסמה מקומית או חשבון Google
ALTER TABLE "Users" ADD CONSTRAINT "Users_has_login_method_chk" CHECK ("passwordHash" IS NOT NULL OR "googleId" IS NOT NULL);
