# EventStyle – שרת ה־API

**EventStyle** היא מערכת לסטודיו לעיצוב אירועים: אתר ציבורי עם גלריות ומחירונים לפי סוג אירוע, אזור אישי שבו לקוחות שולחות בקשות לעיצוב ועוקבות אחרי האירוע, וממשק ניהול שבו המנהלת מאשרת בקשות ומנהלת אירועים, תמונות, גלריה ומחירון.

ה־Repository הזה הוא **צד השרת**: REST API ב־Node.js, Express ו־TypeScript, עם PostgreSQL ו־Prisma.
צד הלקוח (React) נמצא ב־Repository נפרד: `EventStyle-Client`.

| מסמך | למה |
|---|---|
| [START-HERE.md](START-HERE.md) | הפעלה מקומית צעד אחר צעד |
| [FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md) | מדריך מלא לחיבור צד הלקוח: כל Endpoint, טיפוסים, שגיאות ודוגמאות |
| [DEPLOYMENT.md](DEPLOYMENT.md) | הוראות להעלאה עתידית ל־Render |
| [docs/TEST-REPORT.md](docs/TEST-REPORT.md) | דוח הבדיקות |
| `/api-docs` | Swagger – תיעוד חי של ה־API |

---

## 1. תפקידים והרשאות

| תפקיד | איך נוצר | מה מותר |
|---|---|---|
| **Guest** – אורח | – | דף הבית, גלריות ומחירון לפי סוג אירוע, הרשמה והתחברות |
| **Client** – לקוחה | הרשמה עם אימייל וסיסמה, או התחברות ראשונה עם Google. **כל הרשמה יוצרת Client** | כל מה שמותר לאורח, וגם: פרופיל, שליחת בקשות לעיצוב ועריכתן כל עוד הן ממתינות, צפייה **רק** באירועים ובבקשות שלה, העלאת תמונות לאירוע מאושר, הסכמה לפרסום תמונה בגלריה |
| **Admin** – מנהלת | נוצרת רק ב־Seed (אין הרשמה כמנהלת) | אישור ודחייה של בקשות, ניהול מלא של אירועים וסטטוסים, תמונות, גלריה ומחירון |

ההרשאות נאכפות **בשרת** בכל בקשה: `authenticate` (JWT תקף ומשתמש קיים במסד) → `requireRole` / `requireAdmin` → בדיקת בעלות ב־Service. צד הלקוח מסתיר כפתורים לנוחות בלבד.

## 2. הרשמה והתחברות

- **אימייל וסיסמה:** `POST /api/auth/register` יוצר Client ומחזיר JWT מיד – בלי קוד אימות ובלי שליחת מיילים. `POST /api/auth/login` מחזיר JWT.
- **Google:** `POST /api/auth/google` מקבל את ה־ID Token של Google Identity Services. השרת מאמת חתימה, מנפיק, `aud` ותוקף, ומזהה את המשתמש לפי המזהה הקבוע של Google (`sub`).
- **כתובת שכבר רשומה** – תמיד `409`. חשבון קיים לעולם לא מוחלף בהרשמה.
- **`emailVerified`** מציין שהבעלות על הכתובת **הוכחה** (Google מ־Gmail / Workspace, או חשבון שאומת בעבר). הוא לא חוסם התחברות או בקשות, אבל:
  - אירוע שהמנהלת יצרה לפי `clientEmail` מקושר רק לחשבון כזה – כדי שמי שנרשם עם כתובת של אחרת לא יראה את האירוע ואת התמונות הפרטיות שלה.
  - Google מקושר לחשבון סיסמה קיים רק אם הבעלות עליו הוכחה. חשבון לא מוכח בלי אירועים מוחלף בחשבון Google של בעלת הכתובת (id חדש; ה־JWT והסיסמה הישנים נפסלים). חשבון לא מוכח עם בקשות – `409`, בלי שינוי.
- **התנתקות:** ה־JWT הוא Stateless, ולכן אין Endpoint. הלקוח מוחק את ה־Token.

## 3. בקשות לעיצוב אירוע

```
לקוחה ── POST /events/requests ──► Pending ──┬── POST /events/:id/approve (Admin) ──► New ──► Planning ► Preparing ► Ready ► Completed
            ▲                                │                                         (PATCH /events/:id/status – Admin)
            └─ PATCH /events/:id/request ────┤
               (בעלת הבקשה, Pending בלבד)     └── POST /events/:id/reject (Admin) ──► Rejected (נשמרת, עם סיבה רשות)
```

- בקשה היא רשומת `Event` בסטטוס `Pending`. הבעלים, השם והאימייל נקבעים בשרת לפי ה־Token.
- גוף הבקשה הוא Allowlist: שם, סוג, תאריך (לא בעבר), מיקום, חבילה מתאימה לסוג, צבע, מספר אורחים, תקציב, קונספט, הערות. כל שדה אחר (`status`, `userId`, `notes`...) – `400`.
- עריכה – רק בעלת הבקשה ורק כשהיא `Pending`. אחרי אישור או דחייה – `409`.
- אישור ודחייה – רק מנהלת ורק ב־`Pending`. אישור כפול או אישור ודחייה במקביל: רק הראשון מצליח.
- **מניעת כפילויות:** אותה לקוחה + אותו שם (בלי הבדל אותיות) + אותו תאריך – נחסם. שם או תאריך אחרים הם בקשה חדשה ולגיטימית. אחרי דחייה מותר לשלוח שוב.
- **עד 5 בקשות ממתינות** ללקוחה.
- כל הכללים נכונים גם בבקשות מקבילות: נעילת שורה ב־Transaction, `UPDATE` מותנה בסטטוס, ואינדקס ייחודי חלקי `Events_pending_request_key`.

## 4. גלריות, מחירון ותמונות

- **מחירון:** לכל חבילה יש סוג אירוע, או שהיא כללית. המחירון להצגה בלבד – אין תשלום. הסרת חבילה = ארכיון.
- **גלריות:** לכל סוג אירוע גלריה (`category`), עם פרסום/הסתרה, תמונות מובילות וסדר.
- **תמונות אירוע פרטיות:** נשמרות ב־Cloudinary כ־`authenticated`, ונצפות רק בקישור חתום ל־10 דקות שהשרת יוצר אחרי בדיקת הרשאות. העלאה – רק לאירוע מאושר, עד 50 לאירוע, JPEG/PNG/WEBP עד 5MB.
- **עיבוד בשרת (sharp):** סיבוב לפי EXIF, הקטנה עד 2500px והסרת כל המטא־דאטה (כולל GPS) לפני האחסון. כפילויות נחסמות לפי SHA-256.
- **הסכמה ופרסום:** הלקוחה מסכימה (או מבטלת) לכל תמונה; רק המנהלת מפרסמת, והשרת יוצר עותק ציבורי נפרד. ביטול הסכמה מוחק את העותק.

## 5. חיפוש, סינון ומיון

`GET /api/events` (מנהלת) ו־`GET /api/events/my` (לקוחה – רק שלה) מקבלים:
`search` (שם אירוע / לקוחה), `eventType`, `status`, `packageId`, `minBudget`, `maxBudget`, `sortBy` (`eventDate`, `budget`, `clientName`, `eventName`, `createdAt`), `sortDir`, `page`, `limit`.
הסינון והחלוקה לעמודים נעשים במסד, והתשובה היא `{ data, pagination }`.

## 6. טכנולוגיות

| תחום | טכנולוגיה |
|---|---|
| סביבת ריצה | Node.js 22, TypeScript 5.9 (strict) |
| שרת | Express 5 |
| מסד נתונים | PostgreSQL 17 + Prisma ORM 6 |
| Validation | Zod 4 על כל קלט |
| אבטחה | JWT (HS256), bcrypt, Helmet, CORS, Rate Limiting |
| קבצים | Multer (בזיכרון) + sharp + Cloudinary |
| התחברות Google | google-auth-library |
| תיעוד | OpenAPI 3 + Swagger UI |
| בדיקות | Vitest + Supertest, מול PostgreSQL אמיתי (מסד בדיקות נפרד) |

## 7. ארכיטקטורה ומבנה תיקיות

כל בקשה עוברת בשכבות קבועות:
```
Route ──► Middleware (Rate Limit, authenticate, requireRole, upload) ──► Controller (Zod) ──► Service (לוגיקה + Prisma) ──► Mapper (JSON בלי סודות)
                                                       שגיאה בכל שלב ──► HttpError ──► errorHandler ──► { error: { code, message, details } }
```

```
backend/
├── prisma/
│   ├── schema.prisma        # 5 טבלאות: Users, Events, EventPhotos, Packages, GalleryItems
│   ├── migrations/          # 8 Migrations (כולל CHECK ואינדקסים חלקיים)
│   └── seed.ts              # Seed בטוח: יוצר רק מה שחסר. ב-Production – רק המנהלת ו-3 חבילות כלליות
├── src/
│   ├── server.ts            # הפעלת השרת (PORT)
│   ├── app.ts               # Express: Helmet, CORS, Rate Limit, Swagger, Routes, שגיאות
│   ├── config/              # משתני סביבה (נבדקים עם Zod בעלייה), הגדרות תמונות
│   ├── db/                  # Prisma Client
│   ├── auth/                # JWT, bcrypt, אימות Google
│   ├── middleware/          # authenticate / requireRole, העלאות, Rate Limit, errorHandler
│   ├── routes/              # כל הנתיבים וההרשאות במקום אחד
│   ├── controllers/         # קריאת הבקשה, Zod, תשובה
│   ├── services/            # לוגיקה עסקית, ו-storage/ (Cloudinary + עיבוד תמונות)
│   ├── schemas/             # סכמות Zod
│   ├── docs/openapi.ts      # מסמך ה-OpenAPI (Swagger)
│   ├── errors/              # HttpError
│   └── utils/               # Mappers, Pagination
├── tests/                   # 15 קובצי בדיקות
├── docs/                    # openapi.json, הגדרת שירותים, דוח בדיקות
├── scripts/                 # יצירת docs/openapi.json
├── render.yaml              # הגדרת Render (שרת + PostgreSQL)
├── DEPLOYMENT.md            # הוראות העלאה
└── .env.example             # דוגמה למשתני סביבה (בלי סודות)
```

## 8. PostgreSQL ו־Prisma

| טבלה | תוכן | קשרים |
|---|---|---|
| `Users` | משתמשים (Admin / Client), Hash סיסמה, Google, טלפון וכתובת | 1 ← הרבה אירועים |
| `Events` | אירועים ובקשות (`Pending` / `Rejected`), קונספט, הערות הלקוחה, סיבת דחייה, מי בדקה ומתי | `userId` (SET NULL), `packageId` (RESTRICT), `reviewedById` (SET NULL) |
| `EventPhotos` | תמונות אירוע: סוג אחסון, הסכמה לפרסום, מי העלה, SHA-256 | `eventId` (CASCADE), `uploadedById` (SET NULL). ייחודי `(eventId, contentHash)` |
| `Packages` | מחירון: כללי או לפי סוג אירוע, ארכיון וסדר | 1 ← הרבה אירועים |
| `GalleryItems` | גלריה לפי סוג אירוע: פרסום, מובילה, סדר | `sourceEventPhotoId` (ייחודי, SET NULL) |

- **Migrations:** 8, כולם מוחלים במסד הפיתוח ובמסד הבדיקות. בענן הם מוחלים ב־`prisma migrate deploy` בלבד.
- **שלמות נתונים במסד:** CHECK (`guestCount > 0`, `budget >= 0`, `price >= 0`, אימייל באותיות קטנות, שמות לא ריקים), אינדקסים לחיפוש ולסינון, ושני אינדקסים ייחודיים חלקיים שנוצרו ב־Migration ואינם מתוארים ב־schema: `Events_pending_request_key` ו־`Packages_general_name_key`.
- `budget` הוא תקציב העיצוב של האירוע, ואינו מחיר החבילה.

## 9. JWT ואבטחה

- סיסמאות – Hash של bcrypt (12 סבבים) בלבד. משווים גם למשתמש שלא קיים, כדי שזמן התגובה לא יחשוף אילו כתובות רשומות.
- JWT חתום ב־`JWT_SECRET` (לפחות 32 תווים), בתוקף `JWT_EXPIRES_IN` (ברירת מחדל שעתיים). בכל בקשה המשתמש והתפקיד נטענים מחדש מהמסד.
- `401` כשאין התחברות תקינה, `403` כשאין הרשאה. מניעת IDOR: הבעלות נבדקת לפי `userId` מה־Token בלבד.
- Zod על כל קלט; שדות לא מוכרים (כמו `userId` או `role`) נדחים.
- Rate Limiting: 30 בקשות התחברות / הרשמה ב־15 דקות, ו־300 בקשות לדקה לכל ה־API.
- Helmet, CORS לפי `CORS_ORIGIN`, ותשובות שלעולם לא כוללות Hash, מפתחות או Stack Trace.

## 10. Endpoints (35)

הבסיס הוא `/api`. התיעוד המלא – Swagger (`/api-docs`) ו־[FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md).

| # | Method | URL | הרשאה |
|---|---|---|---|
| 1 | POST | `/api/auth/register` | Guest |
| 2 | POST | `/api/auth/login` | Guest |
| 3 | GET | `/api/auth/me` | מחובר |
| 4 | GET | `/api/packages?eventType=` | Guest |
| 5 | GET | `/api/gallery?category=&featured=&page=&limit=` | Guest |
| 6 | POST | `/api/gallery` | Admin |
| 7 | DELETE | `/api/gallery/:id` (לצמיתות) | Admin |
| 8 | GET | `/api/events?search=&eventType=&status=&packageId=&minBudget=&maxBudget=&sortBy=&sortDir=&page=&limit=` | Admin |
| 9 | GET | `/api/events/my` (אותם פרמטרים כמו 8) | מחובר |
| 10 | GET | `/api/events/:id` | Admin או בעלת האירוע |
| 11 | POST | `/api/events` | Admin |
| 12 | PUT | `/api/events/:id` | Admin |
| 13 | PATCH | `/api/events/:id/status` | Admin |
| 14 | DELETE | `/api/events/:id` | Admin |
| 15 | POST | `/api/events/:id/photos` | Admin או בעלת האירוע |
| 16 | DELETE | `/api/events/:id/photos/:photoId` | Admin, או בעלת האירוע לתמונות שהעלתה |
| 17 | GET | `/api/health` | Guest |
| 18 | POST | `/api/auth/google` | Guest |
| 19 | PATCH | `/api/auth/me` | מחובר |
| 20 | POST | `/api/packages` | Admin |
| 21 | PUT | `/api/packages/:id` | Admin |
| 22 | DELETE | `/api/packages/:id` (ארכיון) | Admin |
| 23 | GET | `/api/admin/packages?eventType=&isActive=` | Admin |
| 24 | PATCH | `/api/gallery/:id` | Admin |
| 25 | GET | `/api/gallery/summary` | Guest |
| 26 | GET | `/api/admin/gallery?category=&isPublished=&isFeatured=&page=&limit=` | Admin |
| 27 | GET | `/api/events/:id/photos` | Admin או בעלת האירוע |
| 28 | GET | `/api/events/:id/photos/:photoId` | Admin או בעלת האירוע |
| 29 | PUT | `/api/events/:id/photos/:photoId/consent` | בעלת האירוע בלבד |
| 30 | POST | `/api/events/:id/photos/:photoId/publish` | Admin |
| 31 | GET | `/api/admin/event-photos?eventId=&publishConsent=&inGallery=&page=&limit=` | Admin |
| 32 | POST | `/api/events/requests` | Client |
| 33 | PATCH | `/api/events/:id/request` | בעלת הבקשה, `Pending` בלבד |
| 34 | POST | `/api/events/:id/approve` | Admin |
| 35 | POST | `/api/events/:id/reject` | Admin |

## 11. התקנה והרצה מקומית

דרישות: Node.js 20.19 ומעלה (מומלץ 22), PostgreSQL 17. מדריך מפורט: [START-HERE.md](START-HERE.md).

```bash
npm install
cp .env.example .env          # ולמלא DATABASE_URL ו-JWT_SECRET
npx prisma migrate deploy     # יצירת הטבלאות (רק Migrations שעוד לא הוחלו)
npm run db:seed               # מנהלת, חבילות ונתוני הדגמה (פיתוח)
npm run dev                   # http://localhost:4000
```

| כתובת | מה |
|---|---|
| <http://localhost:4000/api/health> | בדיקת פעילות השרת והמסד |
| <http://localhost:4000/api-docs> | Swagger |

### כניסה כמנהלת

חשבון המנהלת נוצר **רק** ב־Seed (`prisma/seed.ts`), ורק אם הוא עוד לא קיים – ה־Seed לעולם לא משנה סיסמה של חשבון קיים.

| סביבה | אימייל | סיסמה |
|---|---|---|
| פיתוח מקומי | `SEED_ADMIN_EMAIL` (ברירת מחדל `admin@eventstyle.example`) | הערך של `SEED_ADMIN_PASSWORD`. אם הוא ריק בפיתוח – סיסמת הפיתוח `Admin12345` |
| Production | `SEED_ADMIN_EMAIL` | `SEED_ADMIN_PASSWORD` – חובה, לפחות 8 תווים. אין סיסמת ברירת מחדל |

כניסה: באתר ← **התחברות** ← אימייל וסיסמה (לא Google – חשבון מנהלת מתחבר רק עם סיסמה) ← מעבר אוטומטי ל־`/admin`.

משתמשי הדגמה נוספים (פיתוח בלבד): `noa.levi@example.com`, `daniel.cohen@example.com` – סיסמה `Client12345` או `SEED_CLIENT_PASSWORD`.

> אין באפליקציה שינוי סיסמה או "שכחתי סיסמה". אם סיסמת המנהלת אינה ידועה, הדרך הבטוחה היא לקבוע Hash חדש של bcrypt ישירות במסד בפעולה מבוקרת אחרי גיבוי – פעולה שדורשת אישור מפורש, ואינה חלק מהשימוש הרגיל.

## 12. בדיקות

הבדיקות רצות מול **PostgreSQL אמיתי** במסד נפרד (`TEST_DATABASE_URL`), שנמחק בכל הרצה. במסד הפיתוח לא נוגעים.

```bash
cp .env.test.example .env.test   # TEST_DATABASE_URL = מסד בדיקות נפרד
npm test                         # 408 בדיקות אוטומטיות
npm run typecheck                # TypeScript
npm run build                    # Build
npm run check                    # הכול יחד: prisma validate + typecheck + build + tests
```

הבדיקות מכסות: הרשמה, התחברות ו־Google, JWT, הרשאות ו־IDOR, בקשות (כולל כפילויות, מגבלת 5 ופעולות מקבילות), אישור ודחייה, חיפוש וסינון, מחירון, גלריה, תמונות פרטיות, עיבוד תמונות, Seed, ושההתאמה בין Swagger לנתיבים בפועל. דוח: [docs/TEST-REPORT.md](docs/TEST-REPORT.md).

## 13. Swagger

- **חי:** `/api-docs` (או `/docs`) – אפשר לנסות כל Endpoint, כולל `Authorize` עם JWT.
- **קובץ:** [docs/openapi.json](docs/openapi.json), נוצר מ־`src/docs/openapi.ts` ב־`npm run openapi:generate`.
- בדיקה אוטומטית מוודאת שכל 35 הפעולות ב־Swagger קיימות בשרת, ושכל פעולה מוגנת מחזירה `401` בלי Token.

## 14. הכנה לענן

השרת מוכן ל־Render: `PORT` מהסביבה, `trust proxy`, `DATABASE_URL`, `prisma migrate deploy` בכל עלייה, Seed בטוח, ו־`/api/health` לבדיקת תקינות.
הגדרות: [render.yaml](render.yaml). הוראות מלאות, כולל גיבוי, העברת נתונים ובדיקות: [DEPLOYMENT.md](DEPLOYMENT.md).

**הפרויקט עדיין לא נפרס לענן.** הקבצים וההוראות מוכנים, וכל הבדיקות רצו מקומית.

## 15. משתני סביבה

הערכים האמיתיים נמצאים רק ב־`.env` המקומי (לא נכנס ל־Git) ובהגדרות Render. בקובץ [.env.example](.env.example) יש רק שמות וערכים לדוגמה.

| משתנה | חובה | תפקיד |
|---|---|---|
| `NODE_ENV` | – | `development` / `production` / `test` |
| `PORT` | – | ברירת מחדל 4000. Render מגדיר בעצמו |
| `DATABASE_URL` | ✅ | חיבור ל־PostgreSQL |
| `JWT_SECRET` | ✅ | סוד לחתימת ה־Token, לפחות 32 תווים. סוד נפרד לכל סביבה |
| `JWT_EXPIRES_IN` | – | תוקף ה־Token, ברירת מחדל `2h` |
| `CORS_ORIGIN` | ✅ בענן | כתובת האתר (אפשר כמה, מופרדות בפסיק). `/` בסוף הכתובת מוסר אוטומטית. ב־Production אסור `*` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | להעלאת תמונות | בלעדיהם העלאות מחזירות `503` ושאר המערכת עובדת |
| `GOOGLE_CLIENT_ID` | להתחברות Google | אותו Client ID כמו בצד הלקוח. בלעדיו התחברות Google מחזירה `503` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | ✅ ב־Production | יצירת חשבון המנהלת בפעם הראשונה |
| `SEED_CLIENT_PASSWORD`, `SEED_DEMO_PACKAGES` | – | נתוני הדגמה, פיתוח בלבד |
| `TEST_DATABASE_URL` (ב־`.env.test`) | לבדיקות | מסד בדיקות **נפרד**, שנמחק בכל הרצה |

## 16. סביבות: Development, QA ו־Production

| סביבה | מסד נתונים | Seed | הערות |
|---|---|---|---|
| Development | PostgreSQL מקומי (`eventstyle`) | מנהלת, חבילות ונתוני הדגמה | `npm run dev` |
| Test | מסד בדיקות נפרד (`eventstyle_test`) | נמחק ונבנה מחדש בכל הרצה | `npm test` |
| QA | מסד נפרד בענן | כמו Production, עם נתוני ניסיון בלבד | שירות נפרד ב־Render עם סודות משלו (טרם הוקם) |
| Production | מסד Render / Neon | רק המנהלת ו־3 חבילות בארכיון. אין נתוני הדגמה | `NODE_ENV=production`, ‏`autoDeploy: false` (טרם נפרס) |

אותו קוד בכל הסביבות – רק משתני הסביבה משתנים.

## 17. חיבור לצד הלקוח

- צד הלקוח פונה לכתובת `VITE_API_URL` (למשל `http://localhost:4000/api`), שולח `Authorization: Bearer <token>`, ומקבל שגיאות בפורמט אחיד: `{ "error": { "code", "message", "details" } }`.
- כתובת האתר חייבת להופיע ב־`CORS_ORIGIN`.
- העלאת קבצים ב־`multipart/form-data`: שדה `photos` (תמונות אירוע) או `image` (גלריה).
- כל 35 הפעולות ב־Swagger נמצאות בשימוש של צד הלקוח, וצד הלקוח לא פונה לאף כתובת שאינה ב־Swagger.
- המדריך המלא: [FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md).

## 18. פתרון תקלות

| תקלה | פתרון |
|---|---|
| השרת לא עולה: `Invalid environment variables` | חסר משתנה חובה ב־`.env` (ההודעה מציינת איזה) |
| שגיאת CORS בדפדפן | כתובת האתר חסרה ב־`CORS_ORIGIN` |
| העלאת תמונה מחזירה `503` | משתני Cloudinary לא מוגדרים |
| העלאה נכשלת מקומית (`502`) ובלוג `Cloudinary upload failed` | ברשת עם סינון שבודק HTTPS (למשל NetFree), Node לא מכיר את התעודה של הסינון. להפעיל את השרת עם `NODE_OPTIONS=--use-system-ca`. לא רלוונטי ב־Render |

## 19. סטטוס מימוש הדרישות

| נושא | מצב |
|---|---|
| REST API עם 35 פעולות, תיעוד Swagger ובדיקת התאמה אוטומטית | ✅ |
| הרשמה, התחברות (אימייל וסיסמה, Google), JWT והרשאות לפי תפקיד | ✅ |
| בקשות לעיצוב, אישור ודחייה בידי המנהלת, ניהול אירועים | ✅ |
| מחירונים, גלריות, תמונות פרטיות, הסכמה ופרסום לגלריה | ✅ |
| Status Codes ופורמט שגיאה אחיד | ✅ |
| בדיקות אוטומטיות (408) מול מסד בדיקות נפרד | ✅ |
| קובצי פריסה ל־Render והוראות | ✅ מוכנים |
| פריסה בפועל ובדיקה בענן | ⏳ טרם בוצעו |

הפירוט המלא לפי 26 הדרישות של המורה נמצא ב־`FRONTEND-REQUIREMENTS-CHECKLIST.md` ב־Repository של צד הלקוח.
