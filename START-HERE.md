# 🚀 START HERE – מדריך הפעלה צעד אחר צעד

המדריך מסביר איך להפעיל את שרת EventStyle במחשב שלך, ואיך להעלות אותו לענן.

---

## שלב 1 – התקנת Node.js

1. היכנסי ל־<https://nodejs.org> והורידי את גרסת **LTS** (גרסה 22 ומעלה).
2. התקיני עם הגדרות ברירת המחדל.
3. פתחי טרמינל חדש ובדקי:
   ```bash
   node -v    # צריך להופיע v22.x או גבוה יותר
   npm -v
   ```

## שלב 2 – התקנת התלויות

בטרמינל, היכנסי לתיקיית ה־backend:
```bash
cd backend
npm install
```

## שלב 3 – יצירת מסד נתונים PostgreSQL

**אפשרות א' – במחשב (PostgreSQL מותקן אצלך):**
1. פתחי את **pgAdmin**, או את SQL Shell (psql).
2. צרי שני מסדי נתונים:
   ```sql
   CREATE DATABASE eventstyle;
   CREATE DATABASE eventstyle_test;
   ```
   השני משמש רק לבדיקות האוטומטיות.

**אפשרות ב' – בענן (Neon):** ראי [docs/SERVICES-SETUP.md](docs/SERVICES-SETUP.md).

## שלב 4 – משתני סביבה

1. העתיקי את `.env.example` לקובץ חדש בשם `.env`:
   ```bash
   cp .env.example .env
   ```
   ב־Windows אפשר גם להעתיק ולשנות את השם בסייר הקבצים.
2. פתחי את `.env` ומלאי:
   - `DATABASE_URL`: למשל `postgresql://postgres:הסיסמה_שלך@localhost:5432/eventstyle`
   - `JWT_SECRET`: מחרוזת אקראית ארוכה. ליצירה:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - `CORS_ORIGIN`: כתובת צד ה־React. ב־Vite זו בדרך כלל `http://localhost:5173`.
3. את שאר המשתנים אפשר להשאיר כמו שהם בינתיים:
   - אין אימות אימייל בקוד ואין שליחת מיילים. אם נשאר בקובץ `EMAIL_PROVIDER`, השרת מתעלם ממנו.
   - שדות `CLOUDINARY_*` ריקים: העלאת תמונות לא תעבוד עד שתגדירי אותם.

> 🔒 הקובץ `.env` נמצא ב־`.gitignore` ולא יעלה ל־GitHub. כך צריך להיות.

## שלב 5 – Prisma Migrations (יצירת הטבלאות)

```bash
npx prisma migrate deploy
```
צריכה להופיע ההודעה `All migrations have been successfully applied`.

## שלב 6 – Seed (נתוני הדגמה)

```bash
npm run db:seed
```
בסביבת פיתוח הפקודה יוצרת מנהלת, 2 לקוחות, 3 חבילות כלליות, 10 חבילות הדגמה לפי סוג אירוע (2 לכל סוג), 6 אירועים ו־10 פריטי גלריה. היא יוצרת רק מה שחסר, ולא משנה נתונים קיימים. בסיום יודפסו פרטי ההתחברות לפיתוח.

> **ב־Production (`NODE_ENV=production`) לא נוצר אף נתון הדגמה:** רק 3 החבילות הכלליות (כשטבלת החבילות ריקה) והמנהלת (רק עם `SEED_ADMIN_PASSWORD`). אין לקוחות, אירועים, פריטי גלריה או חבילות הדגמה.
> **החבילות הכלליות נוצרות ב־Production בארכיון**, כדי שמחירי ההדגמה לא יוצגו לציבור. אחרי הפריסה הראשונה: עדכני מחיר אמיתי והפעילי כל חבילה (`PUT /api/packages/:id` עם `isActive: true`).
> כדי לוותר על חבילות ההדגמה גם בפיתוח: `SEED_DEMO_PACKAGES=false`.

| תפקיד | אימייל | סיסמה |
|---|---|---|
| Admin | admin@eventstyle.example | Admin12345 |
| Client | noa.levi@example.com | Client12345 |
| Client | daniel.cohen@example.com | Client12345 |

## שלב 7 – הפעלת השרת

```bash
npm run dev
```
צריך להופיע:
```
✅ EventStyle API running on port 4000 (development)
```
בדיקה מהירה: פתחי בדפדפן <http://localhost:4000/api/health>.

## שלב 8 – Swagger

1. פתחי <http://localhost:4000/api-docs>.
2. פתחי את `POST /api/auth/login`, לחצי **Try it out**, הכניסי את פרטי המנהלת ולחצי **Execute**.
3. העתיקי את הערך של `token` מהתשובה.
4. לחצי על **Authorize** (למעלה מימין), הדביקי את ה־Token ולחצי **Authorize**.
5. עכשיו אפשר לנסות את כל הנתיבים של המנהלת.

## שלב 9 – הרצת הבדיקות

```bash
cp .env.test.example .env.test
# ערכי את TEST_DATABASE_URL כך שיצביע על eventstyle_test
npm run check
```
הפקודה מריצה prisma validate, Typecheck, Build ובדיקות.

> ⚠️ הבדיקות **מוחקות את כל הנתונים** במסד הבדיקות. אל תכווני אותן למסד הרגיל!

---

## שלב 10 – העלאה ל־GitHub ול־Render

ההוראות המלאות נמצאות ב־[DEPLOYMENT.md](DEPLOYMENT.md): גיבוי המסד ובדיקת שחזור, GitHub, השרת והמסד ב־Render, אתר ה־React, Google, Cloudinary, העברת נתונים (רשות) ובדיקות אחרי העלאה.

> ה־Repository המקומי כבר קיים – אין צורך ב־`git init`. לפני כל Push ודאי ש־`.env` ו־`.env.test` **לא** מופיעים ב־`git status`.

---

## פתרון תקלות נפוצות

| תקלה | פתרון |
|---|---|
| `Invalid environment variables` בעליית השרת | חסר משתנה ב־`.env`, או שהערך שלו לא תקין. ההודעה מציינת איזה. לדוגמה, `JWT_SECRET` חייב להכיל לפחות 32 תווים. |
| `P1001: Can't reach database server` | PostgreSQL לא פועל, או שה־`DATABASE_URL` שגוי (סיסמה, פורט, שם מסד). ב־Neon ודאי שיש `?sslmode=require`. |
| `P1000: Authentication failed` | שם המשתמש או הסיסמה ב־`DATABASE_URL` שגויים. |
| `EADDRINUSE: port 4000` | שרת אחר כבר רץ על הפורט. סגרי אותו, או שני את `PORT` ב־`.env`. |
| ה־React מקבל שגיאת CORS | הוסיפי את כתובת ה־React ל־`CORS_ORIGIN`. כמה כתובות מפרידים בפסיק, בלי `/` בסוף. |
| 401 בכל בקשה | חסרה הכותרת `Authorization: Bearer <token>`, או שה־Token פג תוקף. התחברי מחדש. |
| 403 | המשתמש מחובר, אבל אין לו הרשאה. למשל לקוח שמנסה לבצע פעולת מנהלת. |
| העלאת תמונה מחזירה 503 | משתני `CLOUDINARY_*` לא הוגדרו. |
| הבדיקות נכשלות עם `TEST_DATABASE_URL is not set` | צרי `.env.test` לפי `.env.test.example`. |
| ב־Render: `prisma: not found` | ודאי שה־Build Command הוא `npm ci --include=dev && npm run build`. |
| שינית את `schema.prisma` | הריצי `npm run db:migrate -- --name תיאור_השינוי`. |
