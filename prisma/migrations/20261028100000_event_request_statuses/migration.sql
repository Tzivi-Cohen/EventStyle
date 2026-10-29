-- בקשות לקוחות: שני סטטוסים חדשים. שינוי שמוסיף בלבד – אירועים קיימים שומרים על הסטטוס שלהם.
-- Pending = בקשה שממתינה לאישור המנהלת, Rejected = בקשה שנדחתה (נשמרת במסד).
-- Migration נפרד: PostgreSQL לא מאפשר להשתמש בערך Enum חדש באותה Transaction שבה נוסף
-- (האינדקס החלקי ב-Migration הבא משתמש ב-'Pending').

-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'Pending';
ALTER TYPE "EventStatus" ADD VALUE 'Rejected';
