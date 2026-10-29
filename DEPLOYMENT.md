# EventStyle – מדריך פריסה ל־Render

המסמך מתאר, צעד אחר צעד, איך לפרוס את EventStyle לענן Render.

**מצב נוכחי:** הקוד נמצא ב־GitHub, בשני מאגרים נפרדים (ראו סעיף 4). **הפריסה ל־Render עדיין לא בוצעה:** אין שירות ב־Render ואין מסד בענן.

**הכלל החשוב:** מסד הנתונים המקומי `eventstyle` לא משתנה בשום שלב. כל הפעולות עליו הן קריאה וגיבוי בלבד.

---

## 0. מה עולה לאן

```
GitHub                         Render
───────────────────────        ─────────────────────────────────────────────
EventStyle (שרת)     ───────►  eventstyle-api-qa   (Web Service, Node)   ─┐
  render.yaml                    /api, /api-docs, /api/health             │ DATABASE_URL
                                                                           ▼
                               Neon: eventstyle-qa (PostgreSQL, Frankfurt)
EventStyle-client    ───────►  eventstyle-client   (Static Site, React)
  render.yaml                    כל נתיב → index.html (React Router)
                                      │ VITE_API_URL
                                      └──────────► eventstyle-api-qa
```

| רכיב | קובץ הגדרה | מה הוא עושה |
|---|---|---|
| שרת ה־API | `backend/render.yaml` | `npm ci --include=dev && npm run build`, ואז `npm run start:render` = `prisma migrate deploy` → Seed בטוח → השרת |
| מסד PostgreSQL | Neon (פרויקט `eventstyle-qa`, מסד `neondb`) | מסד חיצוני. Render לא יוצר מסד; `DATABASE_URL` מוגדר ידנית בשירות (כתובת ה־Direct) |
| אתר ה־React | `EventStyle-Client/render.yaml` | `npm ci && npm run build`, מפרסם את `dist`, וכל נתיב מוחזר ל־`index.html` |

שני הקבצים מוגדרים עם `autoDeploy: false` – Deploy קורה רק כשאת לוחצת על **Manual Deploy**.

**הפרדת סביבות:** `render.yaml` של השרת מגדיר את סביבת **QA**. Production יוקם בהמשך כשירות נפרד (למשל `eventstyle-api`), עם פרויקט Neon משלו וסודות משלו – בלי לשתף מסד, `JWT_SECRET`, סיסמת מנהלת או חשבון Cloudinary עם QA.

---

## 1. לפני הכול – בדיקות מקומיות

בתיקיית `backend`:
```bash
npm run check          # prisma validate + typecheck + build + כל הבדיקות
```
בתיקיית `EventStyle-Client`:
```bash
npm run check          # typecheck + lint + בדיקות + build
npm run test:e2e       # בדיקות בדפדפן (Mock API)
```
כולן צריכות לעבור לפני העלאה.

**סודות:** ודאי שקובצי הסביבה האמיתיים לא ייכנסו ל־Git:
```bash
git check-ignore -v .env .env.test                     # ב-backend – שתי השורות צריכות להופיע
git check-ignore -v .env.development                   # ב-EventStyle-Client
```

---

## 2. גיבוי המסד המקומי ובדיקת שחזור

הגיבוי נעשה **לפני** כל פעולה שקשורה לענן. הוא רק קורא מהמסד.

### 2.1 גיבוי (PowerShell)
```powershell
$pg = "C:\Program Files\PostgreSQL\17\bin"
$stamp = Get-Date -Format "yyyyMMddTHHmmss"
$out = "$env:USERPROFILE\Documents\EventStyle-db-backups\eventstyle_before_cloud_$stamp.dump"
& "$pg\pg_dump.exe" -h localhost -U postgres -d eventstyle -Fc -f $out
```
הסיסמה של PostgreSQL תתבקש בטרמינל. אל תכתבי אותה בקובץ.

### 2.2 בדיקת שחזור – למסד זמני בלבד
```powershell
& "$pg\createdb.exe" -h localhost -U postgres eventstyle_restore_check
& "$pg\pg_restore.exe" -h localhost -U postgres -d eventstyle_restore_check --no-owner $out
```
השווי את מספר השורות בין `eventstyle` ל־`eventstyle_restore_check`:
```sql
SELECT 'Users' t, count(*) FROM "Users" UNION ALL
SELECT 'Events', count(*) FROM "Events" UNION ALL
SELECT 'EventPhotos', count(*) FROM "EventPhotos" UNION ALL
SELECT 'Packages', count(*) FROM "Packages" UNION ALL
SELECT 'GalleryItems', count(*) FROM "GalleryItems" UNION ALL
SELECT '_prisma_migrations', count(*) FROM "_prisma_migrations";
```
אם המספרים זהים – הגיבוי תקין. אחר כך אפשר למחוק את המסד הזמני (`dropdb eventstyle_restore_check`). **לעולם לא את `eventstyle`.**

---

## 3. נתונים אמיתיים מול נתוני ניסיון

| סוג | איך מזהים | המלצה לענן |
|---|---|---|
| נתוני הדגמה מה־Seed | כתובות `@example.com` / `@eventstyle.example`, סיסמאות פיתוח ידועות (`Admin12345`, סיסמת לקוחות ההדגמה) | **לא להעביר.** ב־Production ה־Seed לא יוצר אותם |
| משתמשי בדיקה שנוצרו בפיתוח | נרשמו מקומית לצורך בדיקה | לא להעביר |
| חבילות ומחירון | `Packages` – כל אחת מסומנת כחבילה כללית או לפי סוג אירוע | להעביר רק אם המחירים אמיתיים. אחרת – להזין מחדש דרך ממשק הניהול |
| גלריה | `GalleryItems` – הקבצים עצמם ב־Cloudinary | להעביר רק פריטים אמיתיים, ורק אם משתמשים באותו חשבון Cloudinary |

**ההמלצה:** להתחיל בענן ממסד ריק. ה־Seed של Production יוצר רק את המנהלת ואת 3 החבילות הכלליות (בארכיון). את התוכן האמיתי מזינים דרך ממשק הניהול. כך שום סיסמת פיתוח ושום משתמש ניסיון לא מגיעים לענן.

---

## 4. GitHub

הקוד נמצא בשני מאגרים נפרדים, בענף `main`:

| צד | מאגר |
|---|---|
| שרת | <https://github.com/Tzivi-Cohen/EventStyle> |
| לקוח | <https://github.com/Tzivi-Cohen/EventStyle-client> |

Render מושך את הקוד מהמאגרים האלה. לפני כל עדכון של הקוד בענן, בכל תיקייה:
```bash
git status                       # לבדוק שאין .env ברשימה
git add .
git commit -m "<תיאור השינוי>"
git push
```
אחרי ה־Push, אפשר לבדוק באתר GitHub שקובצי `.env`, `dist`, `node_modules` וגיבויים (`*.dump`) **לא** הועלו. בגלל `autoDeploy: false`, ה־Push לא מעדכן את Render – צריך **Manual Deploy**.

---

## 5. השרת ב־Render (QA, מסד Neon)

1. התחברי ל־<https://render.com> עם GitHub.
2. **New → Blueprint** ← בחרי את המאגר `EventStyle` (השרת). Render יקרא את `render.yaml` ויציג שירות אחד: `eventstyle-api-qa`. מסד הנתונים לא נוצר ב־Render – הוא נמצא ב־Neon.
3. מלאי את המשתנים שמסומנים `sync: false`:

| משתנה | ערך | הערה |
|---|---|---|
| `DATABASE_URL` | כתובת ה־**Direct** (ללא Pooling) של מסד Neon, כולל `sslmode=require` | מ־Neon Dashboard → Connect. אם החיבור נכשל בגלל הפרמטר `channel_binding`, להסיר אותו מהכתובת |
| `CORS_ORIGIN` | כתובת אתר ה־React, למשל `https://eventstyle-client.onrender.com` | בלי `/` בסוף. אפשר כמה כתובות מופרדות בפסיק. בשלב הראשון אפשר לשים ערך זמני ולעדכן אחרי שלב 6 |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | מ־Cloudinary Dashboard | בלעדיהם העלאת תמונות מחזירה 503, ושאר המערכת עובדת |
| `GOOGLE_CLIENT_ID` | Client ID מ־Google Cloud Console | רשות. בלעדיו התחברות Google מושבתת |
| `SEED_ADMIN_EMAIL` | האימייל של המנהלת בענן | |
| `SEED_ADMIN_PASSWORD` | סיסמה **חזקה וחדשה** (לפחות 8 תווים, מומלץ 14+) | לא `Admin12345`. נדרשת רק ביצירה הראשונה |

משתנים שמוגדרים אוטומטית: `JWT_SECRET` (אקראי), `PORT` (Render), `NODE_ENV=production`.

4. **Apply**. Render יוצר את השרת.
5. **מה קורה בעליית השרת:**
   - `prisma migrate deploy` – מריץ את 8 ה־Migrations על המסד הריק. הפקודה רק מוסיפה Migrations שעוד לא הוחלו. **לעולם לא** `migrate reset` או `db push` בענן.
   - Seed – יוצר את המנהלת ואת 3 החבילות הכלליות (בארכיון) רק אם הם חסרים. לא דורס דבר.
   - השרת עולה ו־Render בודק את `/api/health`.
6. בדיקה:
   - `https://eventstyle-api-qa.onrender.com/api/health` → `{"status":"ok","database":"ok",...}`
   - `https://eventstyle-api-qa.onrender.com/api-docs` → Swagger

> **מגבלות המסלול החינמי:** השרת נרדם אחרי זמן ללא שימוש, והבקשה הראשונה לוקחת עד כדקה. גם מסד Neon חינמי נכנס למצב שינה כשאין שימוש, והחיבור הראשון אחריו איטי מעט יותר.

---

## 6. אתר ה־React ב־Render

1. **New → Blueprint** ← המאגר `EventStyle-client`. Render יקרא את `render.yaml` (Static Site).
2. משתנים:

| משתנה | ערך |
|---|---|
| `VITE_API_URL` | `https://eventstyle-api-qa.onrender.com/api` (כולל `/api`) |
| `VITE_GOOGLE_CLIENT_ID` | אותו Client ID כמו בשרת (רשות) |
| `VITE_CONTACT_PHONE`, `VITE_CONTACT_EMAIL` | רשות. ריק = פרטי הסטודיו הציבוריים |

3. **Apply**. ה־Build מריץ `tsc -b && vite build` ומפרסם את `dist`.
4. **ניתוב אחרי רענון:** `render.yaml` מגדיר `rewrite` של `/*` ל־`/index.html`. כך כתובת כמו `/my-events/5` עובדת גם ברענון וגם בקישור ישיר.
5. **חשוב:** משתני `VITE_*` נכנסים לקוד בזמן הבנייה. אחרי כל שינוי בהם – **Manual Deploy** של האתר.

---

## 7. חיבור השניים

1. בשרת: עדכני `CORS_ORIGIN` לכתובת המדויקת של האתר (בלי `/` בסוף) ← **Manual Deploy** לשרת.
2. **Google Sign-In** (אם בשימוש): ב־Google Cloud Console → Credentials → ה־OAuth Client:
   - **Authorized JavaScript origins:** להוסיף את כתובת האתר, למשל `https://eventstyle-client.onrender.com` (ולהשאיר `http://localhost:5173` לפיתוח).
   - בלי זה Google מחזיר שגיאת `origin not allowed`.
3. **Cloudinary:** אין צורך בהגדרה נוספת. תמונות האירועים נשמרות כ־`authenticated` ומוצגות רק בקישור חתום ל־10 דקות.

---

## 8. העברת נתונים נבחרים (רשות, רק אם תחליטי)

ברירת המחדל: **לא מעבירים** (סעיף 3). אם בכל זאת רוצים להעביר חבילות או פריטי גלריה אמיתיים:

1. גיבוי מקומי ובדיקת שחזור (סעיף 2).
2. בענן כבר רצו ה־Migrations (סעיף 5), כך שהטבלאות קיימות.
3. ייצוא נתונים בלבד, לטבלאות שבחרת:
   ```powershell
   & "$pg\pg_dump.exe" -h localhost -U postgres -d eventstyle --data-only --column-inserts `
     --table='"Packages"' --table='"GalleryItems"' -f selected-data.sql
   ```
4. לפתוח את `selected-data.sql`, למחוק שורות של נתוני ניסיון, ולבדוק שאין כפילות מול החבילות שה־Seed יצר בענן.
5. הרצה מול מסד הענן (External Database URL מ־Render, בטרמינל בלבד – לא לשמור בקובץ):
   ```powershell
   & "$pg\psql.exe" "<EXTERNAL_DATABASE_URL>" -v ON_ERROR_STOP=1 -1 -f selected-data.sql
   ```
   `-1` מריץ הכול ב־Transaction אחת: שגיאה אחת מבטלת הכול.
6. עדכון ה־Sequences כדי ש־id חדשים לא יתנגשו:
   ```sql
   SELECT setval(pg_get_serial_sequence('"Packages"','id'), (SELECT max(id) FROM "Packages"));
   SELECT setval(pg_get_serial_sequence('"GalleryItems"','id'), (SELECT max(id) FROM "GalleryItems"));
   ```

**לא להעביר:** `Users` (סיסמאות פיתוח), `Events` ו־`EventPhotos` של ניסיון, ו־`_prisma_migrations` (נוצרת בענן לבד).

---

## 9. בדיקות אחרי העלאה

| # | בדיקה | צפי |
|---|---|---|
| 1 | `/api/health` | `status: ok`, `database: ok` |
| 2 | `/api-docs` | Swagger עם 35 פעולות |
| 3 | האתר, דף הבית, מחירון, גלריה | נטענים בלי שגיאות ב־Console |
| 4 | רענון בעמוד פנימי (`/packages`, `/my-events`) | העמוד נטען (לא 404) |
| 5 | התחברות מנהלת עם `SEED_ADMIN_EMAIL` | מעבר ל־`/admin` |
| 6 | הרשמת לקוחה חדשה ← בקשה לעיצוב | נכנסת מיד, הבקשה `Pending` |
| 7 | המנהלת מאשרת את הבקשה | הסטטוס `New`, והלקוחה רואה אותו |
| 8 | העלאת תמונה לאירוע מאושר | התמונה מוצגת (קישור חתום) |
| 9 | Google Sign-In | נכנסת בלי שגיאת origin |
| 10 | שגיאת CORS ב־Console | אין |

אחרי שהכול עובד: מומלץ למחוק את `SEED_ADMIN_PASSWORD` ממשתני Render (המנהלת כבר קיימת, והמשתנה נדרש רק ביצירה).

---

## 10. תקלות נפוצות

| תקלה | סיבה | פתרון |
|---|---|---|
| שגיאת CORS בדפדפן | `CORS_ORIGIN` לא תואם בדיוק לכתובת האתר | לתקן (בלי `/` בסוף) ← Deploy לשרת |
| האתר פונה ל־`localhost` | `VITE_API_URL` לא הוגדר לפני ה־Build | להגדיר ← Deploy לאתר |
| 404 ברענון עמוד פנימי | חסר ה־rewrite | לוודא ש־`routes` מ־`render.yaml` מופיע ב־Redirects/Rewrites של האתר |
| `origin not allowed` מ־Google | כתובת האתר לא ב־Authorized JavaScript origins | להוסיף ב־Google Cloud Console |
| המנהלת לא נוצרה | `SEED_ADMIN_PASSWORD` חסר או קצר מ־8 תווים | להגדיר ← Deploy (ה־Seed ירוץ שוב וייצור רק אותה) |
| העלאת תמונה מחזירה 503 | חסרים משתני `CLOUDINARY_*` | להגדיר ← Deploy |
| הבקשה הראשונה איטית | השרת החינמי התעורר משינה | תקין |

**אסור בענן:** `prisma migrate reset`, `prisma db push`, `npm run db:reset`, מחיקת המסד.
