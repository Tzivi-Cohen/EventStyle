# EventStyle – Backend

שרת ה־API של **EventStyle – סטודיו לעיצוב אירועים**.

> מתחילה מאפס? פתחי קודם את [START-HERE.md](START-HERE.md).
> כותבת את צד ה־React? פתחי את [FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md).

## מה המערכת עושה

| משתמש | מה מותר לו |
|---|---|
| **Guest** – אורח | דף הבית, גלריה (עם סינון לפי סוג אירוע), חבילות, הרשמה והתחברות |
| **Client** – לקוח | כל מה שמותר לאורח, וגם צפייה באירועים שלו בלבד: פרטים, סטטוס ותמונות |
| **Admin** – מנהלת | ניהול מלא של האירועים (יצירה, עריכה, מחיקה, סטטוס, תמונות), ניהול הגלריה, חיפוש, סינון ומיון |

- כל מי שנרשם באתר מקבל תמיד תפקיד **Client**. חשבון **Admin** נוצר רק ב־Seed.
- **אימות אימייל בקוד:** אחרי ההרשמה נוצר קוד בן 6 ספרות. אין שירות מיילים חיצוני, ולכן הקוד מודפס ביומן השרת (`EMAIL_PROVIDER=console`). הקוד תקף ל־10 דקות, אפשר להשתמש בו פעם אחת, ואחרי 5 ניסיונות שגויים הוא נפסל. אירועים שהמנהלת יצרה עם כתובת האימייל של הלקוח מקושרים אליו **רק אחרי** שאימת את הכתובת.
- הלקוח אף פעם לא קובע `userId` בעצמו. הבעלות על אירוע נבדקת לפי ה־`userId` שבתוך ה־Token.
- הערות פנימיות (`notes`) מוחזרות למנהלת בלבד.

## טכנולוגיות

| תחום | טכנולוגיה |
|---|---|
| סביבת ריצה | Node.js 22 LTS, TypeScript 5.9 (strict) |
| שרת | Express 5 |
| מסד נתונים | PostgreSQL + Prisma ORM 6 |
| Validation | Zod 4 |
| אבטחה | JWT (HS256), bcrypt (bcryptjs), Helmet, CORS, Rate Limiting |
| קבצים | Multer (בזיכרון) + Cloudinary |
| מיילים | אין שירות מיילים חיצוני. קוד האימות מודפס ביומן השרת (`console`) |
| תיעוד | Swagger UI / OpenAPI 3 |
| בדיקות | Vitest + Supertest, מול PostgreSQL אמיתי |

## מבנה הפרויקט

```
backend/
├── prisma/
│   ├── schema.prisma          # 5 טבלאות: Users, Events, EventPhotos, Packages, GalleryItems
│   ├── migrations/            # Migrations (כולל אילוצי CHECK)
│   └── seed.ts                # נתוני הדגמה
├── src/
│   ├── server.ts              # הפעלת השרת
│   ├── app.ts                 # הרכבת Express: Helmet, CORS, Swagger, Routes, שגיאות
│   ├── config/                # משתני סביבה (נבדקים עם Zod) והגדרות אימות
│   ├── db/                    # Prisma Client
│   ├── auth/                  # JWT, Hash סיסמאות, קודי אימות
│   ├── middleware/            # Authentication, Authorization, העלאות, Rate Limit, שגיאות
│   ├── routes/                # הגדרת הנתיבים וההרשאות
│   ├── controllers/           # קבלת הבקשה, Validation והחזרת תשובה
│   ├── services/              # הלוגיקה העסקית + email/ + storage/
│   ├── schemas/               # סכמות Zod
│   ├── docs/openapi.ts        # מסמך OpenAPI
│   ├── errors/                # HttpError
│   └── utils/mappers.ts       # המרת רשומות ל-JSON (בלי סודות)
├── tests/                     # בדיקות אוטומטיות
├── docs/                      # openapi.json, הגדרת שירותים חיצוניים ודוח בדיקות
├── scripts/                   # יצירת docs/openapi.json
├── render.yaml                # פריסה ל-Render
└── .env.example               # דוגמה למשתני סביבה
```

## התקנה והרצה מקומית

```bash
npm install
cp .env.example .env          # ומלאי את DATABASE_URL ו-JWT_SECRET
npx prisma migrate deploy     # יצירת הטבלאות
npm run db:seed               # נתוני הדגמה
npm run dev                   # השרת: http://localhost:4000
```

- Swagger: <http://localhost:4000/api-docs>
- Health: <http://localhost:4000/api/health>

### משתמשי הדגמה (פיתוח בלבד)

| תפקיד | אימייל | סיסמה |
|---|---|---|
| Admin | admin@eventstyle.example | `Admin12345`, או הערך של `SEED_ADMIN_PASSWORD` |
| Client | noa.levi@example.com | `Client12345`, או הערך של `SEED_CLIENT_PASSWORD` |
| Client | daniel.cohen@example.com | `Client12345`, או הערך של `SEED_CLIENT_PASSWORD` |

ב־Production אין סיסמאות ברירת מחדל: חובה להגדיר `SEED_ADMIN_PASSWORD`.

## מסד הנתונים

| טבלה | תוכן | קשרים |
|---|---|---|
| `Users` | משתמשים (Admin/Client), Hash סיסמה, מצב אימות אימייל, טלפון וכתובת (רשות) | 1 משתמש ← הרבה אירועים |
| `Events` | האירועים | `userId → Users.id` (אופציונלי, SET NULL), `packageId → Packages.id` (חובה, RESTRICT) |
| `EventPhotos` | תמונות אירוע | `eventId → Events.id` (CASCADE) |
| `Packages` | 3 חבילות | 1 חבילה ← הרבה אירועים |
| `GalleryItems` | גלריה ציבורית | – |

- **אינדקסים:** `eventDate`, `status`, `eventType`, `packageId`, `userId`, `clientEmail`, `clientName`, `eventName`, `category`.
- **אילוצי CHECK:** `guestCount > 0`, `budget >= 0`, `price >= 0`, אימייל באותיות קטנות, שמות לא ריקים, וכתובת שאינה רווחים בלבד.

פקודות שימושיות: `npm run db:migrate` (Migration חדש בפיתוח), `npm run db:studio` (צפייה בנתונים), `npm run db:reset` (איפוס מלא בפיתוח).

## בדיקות

הבדיקות רצות מול **PostgreSQL אמיתי** במסד נפרד, ומוחקות בו את כל הנתונים.

```bash
cp .env.test.example .env.test   # TEST_DATABASE_URL = מסד בדיקות נפרד
npm test                         # בדיקות אוטומטיות
npm run typecheck                # בדיקת TypeScript
npm run build                    # Build
npm run check                    # הכול יחד: prisma validate + typecheck + build + tests
```

דוח הבדיקות האחרון: [docs/TEST-REPORT.md](docs/TEST-REPORT.md).

## רשימת Endpoints (21)

הבסיס הוא `/api`. התיעוד המלא נמצא ב־Swagger (`/api-docs`, או בקיצור `/docs`) ובקובץ `docs/openapi.json`.

| # | Method | URL | הרשאה |
|---|---|---|---|
| 1 | POST | `/api/auth/register` | Guest |
| 2 | POST | `/api/auth/login` | Guest |
| 3 | GET | `/api/auth/me` | מחובר |
| 4 | POST | `/api/auth/verify-email` | Guest |
| 5 | POST | `/api/auth/resend-code` | Guest |
| 6 | GET | `/api/packages` | Guest |
| 7 | GET | `/api/gallery?category=&page=&limit=` | Guest |
| 8 | POST | `/api/gallery` | Admin |
| 9 | DELETE | `/api/gallery/:id` | Admin |
| 10 | GET | `/api/events?search=&eventType=&status=&packageId=&sortBy=&sortDir=&page=&limit=` | Admin |
| 11 | GET | `/api/events/my?page=&limit=` | מחובר |
| 12 | GET | `/api/events/:id` | Admin או בעל האירוע |
| 13 | POST | `/api/events` | Admin |
| 14 | PUT | `/api/events/:id` | Admin |
| 15 | PATCH | `/api/events/:id/status` | Admin |
| 16 | DELETE | `/api/events/:id` | Admin |
| 17 | POST | `/api/events/:id/photos` | Admin |
| 18 | DELETE | `/api/events/:id/photos/:photoId` | Admin |
| 19 | GET | `/api/health` | Guest |
| 20 | POST | `/api/auth/google` | Guest |
| 21 | PATCH | `/api/auth/me` | מחובר |

17 הפעולות מהאפיון, ועוד 2 פעולות לאימות האימייל (מספרים 4 ו־5), התחברות עם Google (20) ועריכת פרופיל (21).

**התנתקות:** השרת עובד עם JWT בלי מצב (Stateless), ולכן אין Endpoint ל־Logout. הלקוח מוחק את ה־Token מ־`localStorage` ומאפס את המשתמש ב־Context. Token שפג תוקפו (`JWT_EXPIRES_IN`, ברירת מחדל שעתיים) או שהמשתמש שלו נמחק מקבל 401.

הרשימות (7, 10 ו־11) מחולקות לעמודים ומחזירות `{ data, pagination }`. ברירת המחדל היא `page=1` ו־`limit=10`, והמקסימום הוא `limit=100`. פירוט ב־[FRONTEND-API-GUIDE.md](FRONTEND-API-GUIDE.md).

## אבטחה – סיכום

- סיסמאות נשמרות רק כ־Hash של bcrypt (12 סבבים).
- JWT מוגבל בזמן (`JWT_EXPIRES_IN`), והסוד נקרא ממשתנה סביבה.
- בכל בקשה המשתמש נטען מחדש ממסד הנתונים.
- 401 כשאין התחברות תקינה, 403 כשאין הרשאה.
- קודי אימות נשמרים כ־HMAC-SHA256 בלבד, ומושווים בזמן קבוע.
- Rate Limiting על ההרשמה, ההתחברות והאימות, Cooldown של 60 שניות ועד 5 קודים בשעה.
- Zod על כל קלט. שדות לא מוכרים (כמו `userId` או `role`) נדחים.
- העלאות: רק JPEG/PNG/WEBP, עד 5MB, ובדיקת חתימת הקובץ האמיתית (Magic Bytes).
- CORS לפי `CORS_ORIGIN`. Helmet מוסיף כותרות אבטחה.
- תשובות ה־API אף פעם לא כוללות Hash, קודים, מפתחות או Stack Trace.
