-- כתובת אופציונלית בפרופיל המשתמש
-- שינוי שמוסיף בלבד: עמודה שאינה חובה וללא ערך ברירת מחדל. כל המשתמשים הקיימים מקבלים NULL,
-- ושום שורה או ערך קיים לא משתנים.

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "address" VARCHAR(200);

-- כתובת שכולה רווחים אינה תקינה (גם מחוץ ל-API). אין כתובת = NULL
ALTER TABLE "Users" ADD CONSTRAINT "Users_address_not_blank_chk" CHECK ("address" IS NULL OR length(btrim("address")) > 0);
