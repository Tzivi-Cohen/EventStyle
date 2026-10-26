# FRONTEND API GUIDE – מדריך מלא לחיבור צד הלקוח (React) לשרת EventStyle

המדריך מבוסס על קוד השרת בפועל: Routes, Controllers, Services, Zod Schemas ו־Swagger.
כל כתובת, שדה ומבנה נתונים כאן קיימים בשרת. אין כאן Endpoints או שדות מומצאים.

**איך לקרוא את המדריך:**
- פרקים 1–2: הגדרות חיבור ומשתמשים.
- פרק 3: טיפוסי הנתונים.
- פרק 4: כל 21 ה־Endpoints, אחד אחד.
- פרקים 5–6: העלאת תמונות ושגיאות.
- פרק 7: דוגמאות קוד.
- פרק 8: מיפוי מסכים.
- פרק 9: מה **לא** קיים בשרת.
- פרק 10: בדיקת התאמה ל־Swagger.
- פרק 12: הגדרת התחברות עם Google.

> דוגמאות הקוד בפרק 7 הן נקודת פתיחה. התאימי אותן למבנה ולסגנון של הפרויקט שלך.

> **מה חדש בגרסה הזו:**
> - **אין יותר שליחת מיילים (Brevo הוסר):** קוד האימות לא נשלח למייל, אלא מודפס ביומן השרת (`EMAIL_PROVIDER=console`). ההרשמה, האימות והשליחה החוזרת ממשיכים לעבוד באותו מבנה בקשה ותשובה. שגיאת `502 EMAIL_SEND_FAILED` כבר לא קיימת (פרקים 2.2, 4.2 ו־6).
> - **התחברות והרשמה עם Google:** `POST /auth/google` (פרקים 2.6, 4.2 ו־12).
> - **עריכת פרופיל:** `PATCH /auth/me` (פרקים 2.7 ו־4.2).
> - **חלוקה לעמודים (Pagination)** ב־`GET /events`, `GET /events/my` ו־`GET /gallery`. ⚠️ **שינוי במבנה התשובה:** הרשימות מוחזרות עכשיו כ־`{ data, pagination }` ולא כמערך.
> - **אובייקט `User`:** נוסף לו השדה `googleLinked`, ו־`phone` יכול להיות `null`.

---

## תוכן עניינים

1. [הגדרות חיבור בסיסיות](#1-הגדרות-חיבור-בסיסיות)
2. [משתמשים, הרשמה, אימות ו־JWT](#2-משתמשים-הרשמה-אימות-ו-jwt)
3. [טיפוסי נתונים](#3-טיפוסי-נתונים)
4. [כל ה־Endpoints](#4-כל-ה-endpoints)
5. [העלאת תמונות ל־Cloudinary](#5-העלאת-תמונות-ל-cloudinary)
6. [טיפול בשגיאות](#6-טיפול-בשגיאות)
7. [דוגמאות מעשיות ל־React](#7-דוגמאות-מעשיות-ל-react)
8. [מיפוי מסכים ל־API](#8-מיפוי-מסכים-ל-api)
9. [פונקציונליות שאינה קיימת בשרת](#9-פונקציונליות-שאינה-קיימת-בשרת)
10. [בדיקת התאמה לקוד ול־Swagger](#10-בדיקת-התאמה-לקוד-ול-swagger)
11. [משתמשי הדגמה ונתוני Seed](#11-משתמשי-הדגמה-ונתוני-seed)
12. [הגדרת התחברות עם Google](#12-הגדרת-התחברות-עם-google)

---

## 1. הגדרות חיבור בסיסיות

### 1.1 כתובות השרת

| מה | כתובת |
|---|---|
| **Base URL של ה־API (פיתוח)** | `http://localhost:4000/api` |
| Base URL אחרי פריסה | `https://<שם-השירות>.onrender.com/api` |
| Swagger UI (תיעוד אינטראקטיבי) | `http://localhost:4000/api-docs` |
| מסמך OpenAPI בפורמט JSON | `http://localhost:4000/api-docs.json` |
| בדיקת פעילות | `http://localhost:4000/api/health` |

- הפעלת השרת: בתיקייה `backend`, הריצי `npm run dev`.
- כל הנתיבים במדריך כתובים **יחסית ל־Base URL**. למשל, `GET /events` פירושו `GET http://localhost:4000/api/events`.
- כל הבקשות והתשובות הן JSON (`Content-Type: application/json`), **חוץ מהעלאת תמונות**, שנשלחות כ־`multipart/form-data`.
- גודל מקסימלי לגוף JSON: 100KB. מעבר לזה מתקבלת השגיאה `413`.

### 1.2 CORS

| כלל | ערך |
|---|---|
| כתובת צד לקוח מותרת (ברירת מחדל) | `http://localhost:5173`, ברירת המחדל של Vite |
| איפה מגדירים | `CORS_ORIGIN` בקובץ `backend/.env`. אפשר כמה כתובות, מופרדות בפסיק |
| Methods מותרים | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` |
| Headers מותרים | `Content-Type`, `Authorization` |
| Cookies | **לא בשימוש.** ההתחברות עובדת עם Bearer Token |

**חשוב:**
- **פורט אחר:** אם Vite רץ על פורט אחר (למשל `5174`), הדפדפן יחסום את הבקשות. צריך להוסיף את הכתובת ל־`CORS_ORIGIN` ולהפעיל מחדש את השרת.
- **בלי `credentials`:** אל תשתמשי ב־`credentials: 'include'` ב־fetch, ולא ב־`withCredentials: true` ב־Axios. אין בהם צורך, והם יגרמו לחסימת CORS.
- **איך נראית חסימת CORS:** ב־fetch, הבקשה נכשלת עם `TypeError: Failed to fetch`, ובקונסול של הדפדפן מופיעה שגיאת CORS.

### 1.3 הגדרת כתובת ה־API ב־React עם משתני סביבה של Vite

**שלב 1.** צרי בתיקיית פרויקט ה־React (לא בתיקיית `backend`) קובץ בשם `.env.development`:
```
VITE_API_URL=http://localhost:4000/api
```

**שלב 2.** לפני פריסה, צרי קובץ `.env.production` עם הכתובת של השרת בענן:
```
VITE_API_URL=https://<שם-השירות>.onrender.com/api
```

**שלב 3.** קראי את הכתובת בקוד:
```ts
const API_URL = import.meta.env.VITE_API_URL;
```

**שלב 4 (TypeScript, רשות).** כדי לקבל השלמה אוטומטית, הוסיפי לקובץ `src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

**כללים:**
- רק משתנים שמתחילים ב־`VITE_` זמינים בצד הלקוח.
- אחרי שינוי בקובץ `.env` צריך **להפעיל מחדש** את `npm run dev` של Vite.
- **אין לשים סודות** בקובצי `.env` של React. כל מה שבהם נחשף לדפדפן. כתובת ה־API אינה סוד.

### 1.4 fetch או Axios

שתי האפשרויות עובדות. פרק 7 מציג `apiClient` מלא עם fetch, ובסופו גרסה מקבילה ל־Axios.

| | fetch | Axios |
|---|---|---|
| התקנה | מובנה בדפדפן | `npm install axios` |
| שגיאות HTTP (400, 500) | **לא** זורק שגיאה. צריך לבדוק `response.ok` | זורק שגיאה אוטומטית |
| JSON | צריך `JSON.stringify` ו־`response.json()` | אוטומטי |

### 1.5 הגבלת קצב בקשות (Rate Limiting)

| נתיבים | מגבלה לכל כתובת IP |
|---|---|
| `POST /auth/register`, `/auth/login`, `/auth/google`, `/auth/verify-email`, `/auth/resend-code` | 30 בקשות ב־15 דקות (משותף לכולם) |
| כל נתיבי `/api` | 300 בקשות בדקה |

- **חריגה:** מחזירה `429 TOO_MANY_REQUESTS`.
- **בפיתוח רגיל לא תגיעי למגבלה.** זה יכול לקרות רק אם `useEffect` שולח בקשות בלולאה אינסופית.

---

## 2. משתמשים, הרשמה, אימות ו־JWT

### 2.1 תפקידים והרשאות

| תפקיד | איך נוצר | מה מותר |
|---|---|---|
| **Guest** (לא מחובר) | – | צפייה בחבילות ובגלריה, הרשמה, התחברות (עם סיסמה או עם Google) ואימות אימייל |
| **Client** | הרשמה דרך `POST /auth/register`, או התחברות ראשונה עם Google (`POST /auth/google`). **כל הרשמה יוצרת Client** | כל מה שמותר ל־Guest, וגם: צפייה בפרטים שלו ועריכתם (`GET`/`PATCH /auth/me`), צפייה באירועים שלו (`/events/my`) ובאירוע שלו עם תמונות (`/events/:id`) |
| **Admin** (מנהלת הסטודיו) | נוצר רק ב־Seed. אי אפשר להירשם או להתחבר לראשונה כ־Admin, גם לא דרך Google | הכול: ניהול אירועים, סטטוסים, תמונות אירועים וגלריה, וגם עריכת הפרופיל של עצמה |

**סימונים במדריך:** 🌐 Guest (בלי Token) · 👤 כל משתמש מחובר · 👑 Admin בלבד.

> **ההגנה האמיתית נמצאת בשרת.** הסתרת כפתורים לפי `user.role` היא רק לנוחות. גם אם לקוח ינסה לגשת לנתיב של מנהלת, השרת יחזיר `403`.

### 2.2 תהליך ההרשמה ואימות האימייל

```
[טופס הרשמה] ──POST /auth/register──► 201: token + user (emailVerified=false)
       │                                   השרת יוצר קוד בן 6 ספרות (מודפס ביומן השרת)
       ▼
[מסך הזנת קוד] ──POST /auth/verify-email──► 200: token חדש + user (emailVerified=true)
       │   ▲                                   + linkedEventsCount
       │   └── "שלחי שוב" ──POST /auth/resend-code──► 200 (אפשר פעם ב־60 שניות)
       ▼
[האירועים שלי] ──GET /events/my──► האירועים שקושרו ללקוחה
```

**כללי קוד האימות:**
| כלל | ערך |
|---|---|
| אורך | 6 ספרות בדיוק (מחרוזת, למשל `"048213"`, **לא** מספר, כדי לא לאבד אפסים בהתחלה) |
| תוקף | 10 דקות |
| שימוש | חד־פעמי |
| ניסיונות שגויים | עד 5. אחרי החמישי הקוד נפסל, וצריך לבקש קוד חדש |
| שליחה חוזרת | פעם ב־60 שניות, ועד 5 קודים בשעה |
| קוד חדש | מבטל את הקוד הקודם |

**קישור אירועים ללקוחה:**
- המנהלת יוצרת אירועים עם `clientEmail`.
- אירוע מקושר ללקוחה (`userId`) **רק אחרי** שהיא אימתה את כתובת האימייל.
- לכן, לקוחה שעוד לא אימתה תקבל רשימה ריקה ב־`/events/my`.
- ברגע שהיא מאמתת, כל האירועים עם האימייל שלה מקושרים אליה אוטומטית. מספרם מוחזר ב־`linkedEventsCount`.

**איפה מקבלים את הקוד (`EMAIL_PROVIDER=console`):**
- לשרת אין שירות מיילים חיצוני, ולכן **המייל לא נשלח**. זה נכון גם בפיתוח וגם בשרת בענן.
- הקוד מודפס בטרמינל של השרת (או ב־**Logs** של Render) בשורה כמו:
  ```
  📧 [EMAIL_PROVIDER=console] Verification code for noa@example.com: 482913
  ```
- **השפעה על המסכים:** אל תכתבי למשתמשת "שלחנו לך קוד למייל". רק מי שיש לו גישה ליומן השרת (המנהלת) יכול לראות את הקוד. משתמשות Google עם Gmail או Workspace לא צריכות קוד, כי האימייל שלהן מאומת אוטומטית (פרק 2.6).

### 2.3 התחברות

- `POST /auth/login` מחזיר `token` ו־`user`.
- גם משתמשת שלא אימתה את האימייל יכולה להתחבר. בדקי את `user.emailVerified`, ואם הוא `false`, הציגי הודעה וקישור למסך הזנת הקוד.

### 2.4 ניהול JWT

| נושא | פירוט |
|---|---|
| מאיפה מקבלים Token | מ־`register`, `login`, `google` ו־`verify-email`. כולם מחזירים `{ token, user }`. **זה אותו JWT של המערכת** גם אחרי התחברות עם Google |
| איך שולחים | Header בכל בקשה מוגנת: `Authorization: Bearer <token>` |
| תוקף | שעתיים (ברירת המחדל של `JWT_EXPIRES_IN` בשרת). **אין Refresh Token** |
| מה יש בתוך ה־Token | `sub` (מזהה המשתמש כמחרוזת), `role`, `iat` ו־`exp` |
| איפה לשמור | `localStorage` הוא הפתרון הפשוט, והוא מתאים לפרויקט. ה־Token נשמר גם אחרי רענון הדף |
| טעינת האפליקציה | אם יש Token שמור, קראי ל־`GET /auth/me`. אם התשובה `200`, המשתמש מחובר. אם `401`, מחקי את ה־Token |
| Token שפג תוקפו | כל בקשה מוגנת מחזירה `401 UNAUTHORIZED`. מחקי את ה־Token ושלחי את המשתמש למסך ההתחברות |
| אחרי `verify-email` | **החליפי** את ה־Token השמור ב־Token החדש שמוחזר, ועדכני את `user`, כי `emailVerified` השתנה |
| התפקיד | קחי אותו מ־`user.role` שמוחזר מהשרת. אין צורך לפענח את ה־Token. השרת בודק את התפקיד מול מסד הנתונים בכל בקשה |

### 2.5 התנתקות

**אין Endpoint להתנתקות בשרת.** ה־Token הוא Stateless, כלומר השרת לא שומר רשימת התחברויות.

**התנתקות בצד הלקוח:**
1. מחיקת ה־Token מ־`localStorage`.
2. איפוס המשתמש ב־State של האפליקציה.
3. מעבר לדף הבית או למסך ההתחברות.
4. **אם המשתמש התחבר עם Google:** קראי גם ל־`google.accounts.id.disableAutoSelect()` (או `googleLogout()` מ־`@react-oauth/google`). כך Google לא יחבר אותו שוב אוטומטית. זה לא מנתק אותו מחשבון Google עצמו.

### 2.6 התחברות והרשמה עם Google

**איך זה עובד:**
```
[כפתור "התחברות עם Google"]  ← Google Identity Services, בדפדפן
       │  Google מחזיר credential = ID Token (מחרוזת JWT של Google)
       ▼
POST /auth/google { idToken } ──► השרת מאמת את הטוקן מול Google
       │
       ▼
200: { token, user, isNewUser }  ← אותו JWT של המערכת, כמו ב־login
```

- **אותו כפתור משמש גם להרשמה וגם להתחברות.** בכניסה הראשונה השרת יוצר משתמש חדש (`isNewUser: true`).
- **משתמש חדש:**
  - תמיד בתפקיד `Client`.
  - **בלי סיסמה מקומית** ובלי טלפון (`phone: null`). אפשר להוסיף טלפון בעריכת הפרופיל.
  - השם נלקח מחשבון Google.
- **מה השרת בודק בטוקן:** חתימה של Google, מנפיק (`iss`), שהטוקן נוצר עבור האפליקציה שלנו (`aud` = `GOOGLE_CLIENT_ID`), ותוקף. אם משהו לא תקין, מתקבל `401 GOOGLE_AUTH_FAILED`.
- **ה־ID Token של Google לא נשמר בשרת** ואין צורך לשמור אותו בצד הלקוח. שומרים רק את ה־`token` של המערכת, כמו בהתחברות רגילה.

**מתי האימייל נחשב מאומת:**
| סוג כתובת | `emailVerified` | אירועים קיימים |
|---|---|---|
| Gmail (`@gmail.com`), או דומיין של Google Workspace | `true` מיד | מקושרים מיד |
| כל כתובת אחרת (למשל `@walla.co.il` שמחוברת לחשבון Google) | `false` | מקושרים רק אחרי אימות בקוד: `POST /auth/resend-code` ואז `POST /auth/verify-email`, בדיוק כמו בהרשמה רגילה |

**חשבון קיים עם אותו אימייל:**
| מצב | תוצאה |
|---|---|
| החשבון כבר מקושר לאותו חשבון Google | התחברות רגילה (הזיהוי לפי מזהה Google, גם אם האימייל השתנה) |
| חשבון רגיל (עם סיסמה) **מאומת**, וכתובת Gmail או Workspace | החשבון מקושר ל־Google. מעכשיו אפשר להתחבר בשתי הדרכים, **והסיסמה ממשיכה לעבוד** |
| חשבון רגיל, וכתובת שאינה Gmail או Workspace | `409`: "התחברי עם אימייל וסיסמה". החשבון לא משתנה |
| חשבון רגיל שעוד **לא אימת** את האימייל, וכתובת Gmail או Workspace | `200` עם `isNewUser: true`: Google מוכיחה שזו בעלת הכתובת, ולכן החשבון הלא מאומת **מוחלף** בחשבון Google חדש ומאומת (`id` חדש). הסיסמה והטלפון של החשבון הישן לא עוברים, וכל Token ישן שלו מקבל `401` |
| חשבון Admin | `409`: מנהלת מתחברת רק עם סיסמה |
| האימייל כבר מקושר לחשבון Google **אחר** | `409` |

> **למה לא מקשרים לפי אימייל בלבד?** כדי שמי שפתח חשבון עם כתובת של מישהו אחר (בלי לאמת אותה) לא יקבל גישה לחשבון של בעל הכתובת האמיתי, ולהפך. חשבון לא מאומת לא "חוסם" את בעלת הכתובת: כשהיא מוכיחה בעלות דרך Google (או נרשמת מחדש ומאמתת בקוד), החשבון הלא מאומת מוחלף, ומי שתפס את הכתובת מאבד את הגישה.

**משתמש שנרשם רק עם Google:**
- **התחברות עם סיסמה:** תחזיר `401 INVALID_CREDENTIALS`, כי אין לו סיסמה. הציגי לו את כפתור Google.
- **הרשמה רגילה עם אותו אימייל:** תחזיר `409`.

### 2.7 צפייה בפרופיל ועריכתו

| פעולה | Endpoint |
|---|---|
| צפייה | `GET /auth/me` |
| עריכה | `PATCH /auth/me` עם `fullName`, `phone` ו/או `address` |

**כללים:**
- **מה אפשר לערוך:** רק **שם**, **טלפון** ו**כתובת**, ורק של המשתמש המחובר. המזהה נלקח מה־Token, ואין דרך לבחור משתמש אחר.
- **כתובת (`address`):** אופציונלית, עד 200 תווים. נוספת **רק** בעריכת הפרופיל ולא בהרשמה. `null`, `""` או רווחים בלבד מוחקים אותה. משתמשת שלא הוסיפה כתובת מקבלת `address: null`.
- **שדות לקריאה בלבד:** אימייל, תפקיד, חיבור ל־Google ומצב האימות **אינם ניתנים לשינוי**. שליחתם תחזיר `400`.
  - **אימייל:** הציגי אותו בטופס כשדה לקריאה בלבד (`readOnly`).
  - **`googleLinked`:** אפשר להציג אותו כתג "מחובר עם Google".
- **אחרי עדכון:** התשובה היא `{ user }` המעודכן. עדכני ממנה את המשתמש ב־State. ה־Token לא משתנה.
- **אין שינוי סיסמה ואין איפוס סיסמה** (ראי פרק 9).

---

## 3. טיפוסי נתונים

### 3.1 Enums

#### EventType – סוג אירוע
| ערך (נשלח לשרת) | תצוגה בעברית |
|---|---|
| `Birthday` | יום הולדת |
| `BatMitzvah` | בת מצווה |
| `Brit` | ברית / בריתה |
| `Corporate` | אירוע חברה |
| `Private` | אירוע פרטי |

#### EventStatus – סטטוס הכנות (לפי סדר ההתקדמות)
| ערך | תצוגה בעברית |
|---|---|
| `New` | חדש |
| `Planning` | בתכנון |
| `Preparing` | בהכנות |
| `Ready` | מוכן |
| `Completed` | הושלם |

#### Role
`Admin` | `Client`

> הערכים **רגישים לאותיות גדולות וקטנות**. `birthday` או `wedding` יחזירו `400`.

### 3.2 טיפוסי TypeScript מוכנים להעתקה

הטיפוסים תואמים בדיוק למה שהשרת מחזיר (`src/utils/mappers.ts`):

```ts
// src/types/api.ts
export const EVENT_TYPES = ['Birthday', 'BatMitzvah', 'Brit', 'Corporate', 'Private'] as const;
export const EVENT_STATUSES = ['New', 'Planning', 'Preparing', 'Ready', 'Completed'] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type Role = 'Admin' | 'Client';

export interface User {
  id: number;
  fullName: string;
  email: string;          // תמיד באותיות קטנות. לקריאה בלבד
  phone: string | null;   // null אצל משתמש Google שעוד לא הוסיף טלפון
  address: string | null; // null כשלא הוגדרה כתובת
  role: Role;
  emailVerified: boolean;
  googleLinked: boolean;  // האם אפשר להתחבר לחשבון עם Google
  createdAt: string;      // ISO, למשל "2026-10-01T09:00:00.000Z"
}

export interface AuthResult {
  token: string;
  user: User;
}

/** תשובת POST /auth/google */
export interface GoogleAuthResult extends AuthResult {
  isNewUser: boolean;
}

/** גוף PATCH /auth/me – לפחות שדה אחד */
export interface ProfileUpdate {
  fullName?: string;
  phone?: string;
  address?: string | null; // null או "" מוחקים את הכתובת
}

/** מידע החלוקה לעמודים שמוחזר בכל רשימה */
export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;     // 0 כשאין תוצאות
}

/** תשובת רשימה: GET /events, GET /events/my, GET /gallery */
export interface Paginated<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface PageParams {
  page?: number;          // ברירת מחדל 1
  limit?: number;         // ברירת מחדל 10, מקסימום 100
}

export interface Package {
  id: number;
  name: string;
  description: string;
  price: number;                 // מחיר המחירון הנוכחי. לא נשמר בהזמנות
  features: string[];
  imageUrl: string;
  eventType: EventType | null;   // null = חבילה כללית שמתאימה לכל סוג אירוע
  sortOrder: number;             // סדר ההצגה בתוך הסוג
}

/** חבילה בממשק הניהול (GET /admin/packages, POST/PUT /packages) */
export interface AdminPackage extends Package {
  isActive: boolean;             // false = בארכיון
  eventCount?: number;           // כמה הזמנות משתמשות בחבילה
  createdAt: string;
  updatedAt: string;
}

/** גוף POST /packages ו-PUT /packages/:id */
export interface PackageInput {
  name: string;
  description: string;
  price: number;
  features: string[];
  imageUrl: string;              // https בלבד
  eventType: EventType | null;   // חובה בגוף הבקשה
  isActive?: boolean;
  sortOrder?: number;
}

export interface GalleryItem {
  id: number;
  title: string;
  category: EventType;
  url: string;
  publicId: string | null;  // מזהה ב־Cloudinary. לא נדרש לתצוגה
  isFeatured: boolean;      // תמונה מובילה (דף הבית, תמונת שער)
  sortOrder: number;        // סדר ההצגה (ואז החדשים קודם)
  createdAt: string;
}

/** פריט גלריה בממשק הניהול (GET /admin/gallery, POST /gallery, PATCH /gallery/:id) */
export interface AdminGalleryItem extends GalleryItem {
  isPublished: boolean;     // false = מוסתר מכל הנתיבים הציבוריים
  updatedAt: string;
}

/** גוף PATCH /gallery/:id – לפחות שדה אחד */
export interface GalleryUpdate {
  title?: string;
  category?: EventType;
  isPublished?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
}

/** שורה בתשובת GET /gallery/summary – אחת לכל סוג אירוע */
export interface GallerySummaryItem {
  category: EventType;
  count: number;              // תמונות מפורסמות בלבד
  cover: GalleryItem | null;  // null כשאין תמונות מפורסמות בסוג
}

export interface EventPhoto {
  id: number;
  eventId: number;
  url: string;
  publicId: string | null;
  createdAt: string;
}

export interface EventItem {          // השם Event תפוס בדפדפן, לכן EventItem
  id: number;
  eventName: string;
  clientName: string;
  clientEmail: string;
  eventType: EventType;
  eventDate: string;                  // "YYYY-MM-DD"
  location: string;
  packageId: number;
  package?: { id: number; name: string };
  themeColor: string;
  guestCount: number;
  budget: number;
  status: EventStatus;
  coverImageUrl: string | null;
  notes?: string | null;              // רק למנהלת. אצל לקוח השדה לא קיים
  userId: number | null;
  photoCount?: number;                // רק ברשימות (GET /events, GET /events/my)
  photos?: EventPhoto[];              // רק באירוע בודד (GET/POST/PUT/PATCH)
  createdAt: string;
  updatedAt: string;
}

/** גוף הבקשה ליצירה ולעריכה של אירוע */
export interface EventInput {
  eventName: string;
  clientName: string;
  clientEmail: string;
  eventType: EventType;
  eventDate: string;                  // "YYYY-MM-DD"
  location: string;
  packageId: number;
  themeColor: string;
  guestCount: number;
  budget: number;
  status?: EventStatus;
  coverImageUrl?: string | null;
  notes?: string | null;
}

export interface GalleryFilters extends PageParams {
  category?: EventType;
  featured?: boolean;   // נשלח כ־"true" / "false"
}

export interface EventFilters extends PageParams {
  search?: string;
  eventType?: EventType;
  status?: EventStatus;
  packageId?: number;
  sortBy?: 'eventDate' | 'budget' | 'clientName';
  sortDir?: 'asc' | 'desc';
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

### 3.3 Event: מתי מוחזר כל שדה

| שדה | רשימה (`GET /events`, `GET /events/my`) | אירוע בודד (`GET/POST/PUT/PATCH`) |
|---|---|---|
| `package` (`{ id, name }`) | ✔ | ✔ |
| `photoCount` | ✔ | ✘ |
| `photos` | ✘ | ✔ (ממוינות מהישנה לחדשה) |
| `notes` | ✔ למנהלת. ✘ ללקוח | ✔ למנהלת. ✘ ללקוח |

### 3.4 הערות על פורמטים

| שדה | פורמט | טיפ ל־React |
|---|---|---|
| `eventDate` | `"YYYY-MM-DD"` | מתאים ישירות ל־`<input type="date">`. לתצוגה: `eventDate.split('-').reverse().join('/')` נותן `15/12/2026`, בלי בעיות של אזורי זמן |
| `createdAt`, `updatedAt` | ISO מלא | `new Date(createdAt).toLocaleString('he-IL')` |
| `budget`, `price` | number | `new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(budget)` |
| `themeColor` | טקסט, 1–30 תווים | אם זה קוד צבע (`#F4C2C2`), אפשר להשתמש ב־`<input type="color">` ולהציג ריבוע צבע |
| `clientEmail`, `email` | השרת מוריד רווחים וממיר לאותיות קטנות | |

---

## 4. כל ה־Endpoints

### 4.1 טבלת סיכום (21 פעולות)

| # | Method | URL | JWT | הרשאה | תפקיד |
|---|---|---|---|---|---|
| 1 | POST | `/auth/register` | ✘ | 🌐 | הרשמת לקוחה |
| 2 | POST | `/auth/verify-email` | ✘ | 🌐 | אימות אימייל בקוד |
| 3 | POST | `/auth/resend-code` | ✘ | 🌐 | שליחה חוזרת של קוד |
| 4 | POST | `/auth/login` | ✘ | 🌐 | התחברות |
| 5 | GET | `/auth/me` | ✔ | 👤 | פרטי המשתמש המחובר |
| 6 | GET | `/packages?eventType=` | ✘ | 🌐 | המחירון: חבילות פעילות, עם סינון רשות לפי סוג אירוע |
| 7 | GET | `/gallery` | ✘ | 🌐 | גלריה, עם סינון ועמודים |
| 8 | POST | `/gallery` | ✔ | 👑 | הוספת תמונה לגלריה |
| 9 | DELETE | `/gallery/:id` | ✔ | 👑 | מחיקת תמונה מהגלריה לצמיתות |
| 10 | GET | `/events` | ✔ | 👑 | כל האירועים: חיפוש, סינון, מיון ועמודים |
| 11 | GET | `/events/my` | ✔ | 👤 | האירועים של המשתמש המחובר, בעמודים |
| 12 | GET | `/events/:id` | ✔ | 👑 או בעלת האירוע | אירוע בודד עם תמונות |
| 13 | POST | `/events` | ✔ | 👑 | יצירת אירוע |
| 14 | PUT | `/events/:id` | ✔ | 👑 | עריכת אירוע (החלפה מלאה) |
| 15 | PATCH | `/events/:id/status` | ✔ | 👑 | עדכון סטטוס |
| 16 | DELETE | `/events/:id` | ✔ | 👑 | מחיקת אירוע |
| 17 | POST | `/events/:id/photos` | ✔ | 👑 | העלאת תמונות לאירוע |
| 18 | DELETE | `/events/:id/photos/:photoId` | ✔ | 👑 | מחיקת תמונת אירוע |
| 19 | GET | `/health` | ✘ | 🌐 | בדיקת פעילות השרת ומסד הנתונים |
| 20 | POST | `/auth/google` | ✘ | 🌐 | **חדש:** התחברות או הרשמה עם Google |
| 21 | PATCH | `/auth/me` | ✔ | 👤 | **חדש:** עריכת הפרופיל של המשתמש המחובר |
| 22 | POST | `/packages` | ✔ | 👑 | **חדש:** יצירת חבילה |
| 23 | PUT | `/packages/:id` | ✔ | 👑 | **חדש:** עריכת חבילה: מחיר, פרטים, סוג, סדר, החזרה מארכיון |
| 24 | DELETE | `/packages/:id` | ✔ | 👑 | **חדש:** העברת חבילה לארכיון (ללא מחיקה) |
| 25 | GET | `/admin/packages` | ✔ | 👑 | **חדש:** כל החבילות לניהול, כולל ארכיון ומספר הזמנות |
| 26 | PATCH | `/gallery/:id` | ✔ | 👑 | **חדש:** עריכת פריט גלריה: כותרת, סוג, פרסום/הסתרה, מובילה, סדר |
| 27 | GET | `/gallery/summary` | ✘ | 🌐 | **חדש:** לכל סוג אירוע – מספר תמונות מפורסמות ותמונת שער |
| 28 | GET | `/admin/gallery` | ✔ | 👑 | **חדש:** כל פריטי הגלריה לניהול, כולל מוסתרים |

> המספרים 20–28 נוספו בסוף כדי לשמור על המספור הקודם. התיעוד המלא של 20 ו־21 נמצא בפרק 4.2, אחרי `GET /auth/me`, של 22–25 בפרק 4.3, ושל 26–28 בפרק 4.4.

**כללים שחלים על כל ה־Endpoints:**
- **Path Parameters:** `:id` ו־`:photoId` חייבים להיות מספרים שלמים חיוביים. אחרת מתקבל `400 VALIDATION_ERROR` עם `field: "id"` (או `"photoId"`).
- **שדות לא מוכרים:** כל גופי ה־JSON בודקים שאין שדות כאלה (`strictObject`). שליחת שדה מיותר, כמו `userId` או `role`, מחזירה `400` עם `field: ""` והודעה `Unrecognized keys: "userId"`.
- **שגיאות כלליות שלא חוזרות בכל Endpoint:**
  - `429` (הגבלת קצב).
  - `500 INTERNAL_ERROR` (תקלה בשרת).
  - בנתיבים מוגנים: `401` אם אין Token או שהוא לא תקין.
  - בנתיבים 👑: `403` אם המשתמש אינו Admin.

---

### 4.2 Auth

#### 1. `POST /auth/register` 🌐 – הרשמה

יוצרת משתמש בתפקיד **Client** עם `emailVerified: false`, ויוצרת קוד אימות. הקוד מודפס ביומן השרת ולא נשלח במייל (פרק 2.2).

**Request Body:**
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `fullName` | string | ✔ | 2–100 תווים |
| `email` | string | ✔ | אימייל תקין, עד 254 תווים. רווחים ואותיות גדולות מנורמלים בשרת |
| `phone` | string | ✔ | 7–19 תווים: ספרות, רווחים ומקפים. מותר `+` בהתחלה. למשל `050-1234567` |
| `password` | string | ✔ | 8–72 תווים, לפחות אות אנגלית אחת וספרה אחת |

```json
{
  "fullName": "נועה לוי",
  "email": "noa.levi@example.com",
  "phone": "050-1234567",
  "password": "Secret123"
}
```

**Response `201`:**
```json
{
  "message": "Registration successful. A 6-digit verification code was sent to noa.levi@example.com",
  "verificationEmailSent": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 5,
    "fullName": "נועה לוי",
    "email": "noa.levi@example.com",
    "phone": "050-1234567",
    "address": null,
    "role": "Client",
    "emailVerified": false,
    "googleLinked": false,
    "createdAt": "2026-10-25T09:00:00.000Z"
  }
}
```

**שגיאות:**
| HTTP | code | מתי |
|---|---|---|
| 400 | `VALIDATION_ERROR` | שדה חסר או לא תקין, או שדה מיותר (למשל `role`) |
| 409 | `CONFLICT` | `An account with this email already exists`: האימייל כבר רשום **ומאומת**, או שייך לחשבון שמקושר ל־Google (אז מתחברים עם כפתור Google). במקרה נדיר של בקשה מקבילה: `The account was changed by another request. Please try again` |
| 429 | `TOO_MANY_REQUESTS` | הרשמה חוזרת לאותו אימייל לא מאומת תוך פחות מ־60 שניות, או יותר מ־5 קודים בשעה. ראי `details.retryAfterSeconds` |

**הערות:**
- **אימייל רשום שלא אומת:** אם קיים חשבון **לא מאומת** עם אותו אימייל (לא Admin ולא מקושר ל־Google), ההרשמה **מחליפה** אותו בחשבון חדש עם `id` חדש ושולחת קוד חדש. התשובה היא `201`. כל Token של החשבון הישן מקבל `401`, והקוד הישן כבר לא תקף. מגבלות השליחה (60 שניות, 5 קודים בשעה) ממשיכות לחול.
- **`verificationEmailSent`:** השדה נשאר בתשובה כדי לשמור על תאימות, ותמיד יהיה `true`, כי הדפסת הקוד ביומן השרת לא נכשלת. ההודעה `message` עדיין אומרת `...was sent to <email>`, אבל בפועל הקוד נמצא ביומן השרת.
- **אחרי הרשמה:** שמרי את ה־Token ועברי למסך הזנת הקוד.

---

#### 2. `POST /auth/verify-email` 🌐 – אימות האימייל

**Request Body:**
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `email` | string | ✔ | אימייל תקין |
| `code` | string | ✔ | בדיוק 6 ספרות |

```json
{ "email": "noa.levi@example.com", "code": "482913" }
```

**Response `200`:**
```json
{
  "message": "Email verified successfully",
  "linkedEventsCount": 2,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 5,
    "fullName": "נועה לוי",
    "email": "noa.levi@example.com",
    "phone": "050-1234567",
    "address": null,
    "role": "Client",
    "emailVerified": true,
    "googleLinked": false,
    "createdAt": "2026-10-25T09:00:00.000Z"
  }
}
```

**שגיאות:**
| HTTP | code | message | מתי |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `Validation failed` | הקוד אינו 6 ספרות, או שהאימייל לא תקין |
| 400 | `INVALID_CODE` | `Invalid verification code` + `details: { "attemptsLeft": 3 }` | קוד שגוי |
| 400 | `INVALID_CODE` | `Too many wrong attempts. The code was cancelled, please request a new one` | ניסיון שגוי חמישי. הקוד נפסל |
| 400 | `INVALID_CODE` | `Invalid verification code. Check the code or request a new one` | אין קוד פעיל: הוא כבר נפסל, או שהאימייל לא קיים במערכת |
| 400 | `CODE_EXPIRED` | `Verification code has expired. Please request a new one` | עברו 10 דקות |
| 409 | `CONFLICT` | `Email is already verified` | האימייל כבר אומת |

**הערות:**
- **אחרי הצלחה:** החליפי את ה־Token השמור ב־Token החדש, ועדכני את `user`.
- **`linkedEventsCount`:** אפשר להציג אותו, למשל "נמצאו 2 אירועים שלך".

---

#### 3. `POST /auth/resend-code` 🌐 – שליחה חוזרת של קוד

**Request Body:**
| שדה | טיפוס | חובה |
|---|---|---|
| `email` | string | ✔ |

```json
{ "email": "noa.levi@example.com" }
```

**Response `200`:**
```json
{ "message": "If an unverified account exists for this email, a new verification code has been sent" }
```

**התשובה זהה בכל מקרה:** גם אם האימייל לא רשום, וגם אם הוא כבר מאומת. כך השרת לא חושף אילו כתובות רשומות.

**שגיאות:**
| HTTP | code | מתי |
|---|---|---|
| 400 | `VALIDATION_ERROR` | אימייל לא תקין |
| 429 | `TOO_MANY_REQUESTS` | `Please wait 42 seconds before requesting a new code` + `details: { "retryAfterSeconds": 42 }`, או יותר מ־5 קודים בשעה |

**טיפ:** אחרי שליחה, השביתי את כפתור "שלחי שוב" ל־60 שניות והציגי ספירה לאחור. אם התקבל 429, השתמשי ב־`details.retryAfterSeconds` כדי להתחיל את הספירה מהמקום הנכון.

---

#### 4. `POST /auth/login` 🌐 – התחברות

**Request Body:**
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `email` | string | ✔ | אימייל תקין |
| `password` | string | ✔ | 1–72 תווים |

```json
{ "email": "admin@eventstyle.example", "password": "Admin12345" }
```

**Response `200`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "fullName": "מנהלת הסטודיו",
    "email": "admin@eventstyle.example",
    "phone": "050-0000000",
    "address": null,
    "role": "Admin",
    "emailVerified": true,
    "googleLinked": false,
    "createdAt": "2026-10-24T19:00:00.000Z"
  }
}
```

**שגיאות:**
| HTTP | code | מתי |
|---|---|---|
| 400 | `VALIDATION_ERROR` | שדה חסר או אימייל לא תקין |
| 401 | `INVALID_CREDENTIALS` | `Invalid email or password`. אותה הודעה גם לאימייל לא קיים וגם לסיסמה שגויה |
| 429 | `TOO_MANY_REQUESTS` | יותר מ־30 ניסיונות ב־15 דקות |

**אחרי התחברות:**
- אם `user.role === 'Admin'`, עברי ללוח הניהול.
- אם `user.emailVerified === false`, הציגי קישור למסך הזנת הקוד.

---

#### 5. `GET /auth/me` 👤 – פרטי המשתמש המחובר

- **Headers:** `Authorization: Bearer <token>`
- **Body:** אין.

**Response `200`:**
```json
{
  "user": {
    "id": 2,
    "fullName": "נועה לוי",
    "email": "noa.levi@example.com",
    "phone": "050-1234567",
    "address": null,
    "role": "Client",
    "emailVerified": true,
    "googleLinked": false,
    "createdAt": "2026-10-24T19:00:00.000Z"
  }
}
```

> שימי לב: התשובה עטופה ב־`{ "user": ... }`, בלי `token`.

**שגיאות:**
| HTTP | code | message |
|---|---|---|
| 401 | `UNAUTHORIZED` | `Missing Bearer token`, `Invalid or expired token`, או `User no longer exists` |

---

#### 20. `POST /auth/google` 🌐 – התחברות או הרשמה עם Google (חדש)

מקבל את ה־ID Token ש־Google Identity Services מחזיר בדפדפן, ומחזיר את ה־JWT של המערכת. רקע מלא בפרק 2.6, והגדרות בפרק 12.

**Request Body:**
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `idToken` | string | ✔ | ה־`credential` שהתקבל מ־Google, עד 4096 תווים. **אסור לשלוח שדות נוספים** (למשל `role`), אחרת מתקבלת שגיאת 400 |

```json
{ "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..." }
```

**Response `200`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 7,
    "fullName": "Noa Levi",
    "email": "noa.levi@gmail.com",
    "phone": null,
    "address": null,
    "role": "Client",
    "emailVerified": true,
    "googleLinked": true,
    "createdAt": "2026-10-25T09:00:00.000Z"
  },
  "isNewUser": true
}
```

- **`isNewUser`:** `true` אם החשבון נוצר עכשיו. זו הזדמנות להציע למשתמש להשלים טלפון בפרופיל.
- **`user.emailVerified === false`:** קורה רק בכתובת שאינה Gmail או Workspace. במקרה כזה, העבירי למסך הזנת הקוד (ראי פרק 2.6).

**שגיאות:**
| HTTP | code | message | מתי |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `Validation failed` | `idToken` חסר או ריק, או שנשלח שדה נוסף |
| 401 | `GOOGLE_AUTH_FAILED` | `Invalid or expired Google token` | חתימה, מנפיק, `aud` או תוקף לא תקינים |
| 401 | `GOOGLE_AUTH_FAILED` | `The email address of this Google account is not verified` | חשבון Google שהאימייל שלו לא מאומת אצל Google |
| 409 | `CONFLICT` | `An account with this email already exists. Sign in with your email and password` | חשבון קיים, וכתובת שאינה Gmail או Workspace |
| 409 | `CONFLICT` | `The account was changed by another request. Please try again` | נדיר: החשבון השתנה בדיוק באותו רגע (למשל אומת או הוחלף בבקשה מקבילה). אפשר לנסות שוב |
| 409 | `CONFLICT` | `This account must sign in with email and password` | חשבון Admin |
| 409 | `CONFLICT` | `This email is already linked to a different Google account` | האימייל מקושר לחשבון Google אחר |
| 429 | `TOO_MANY_REQUESTS` | | יותר מ־30 ניסיונות ב־15 דקות (משותף לכל נתיבי ההתחברות) |
| 502 | `GOOGLE_UNAVAILABLE` | `Could not reach Google to verify the sign-in. Please try again` | השרת לא הצליח לפנות ל־Google |
| 503 | `GOOGLE_AUTH_NOT_CONFIGURED` | `Google sign-in is not configured on the server` | `GOOGLE_CLIENT_ID` לא מוגדר בשרת |

---

#### 21. `PATCH /auth/me` 👤 – עריכת פרופיל (חדש)

- **Headers:** `Authorization: Bearer <token>`
- **הרשאה:** כל משתמש מחובר, Client או Admin. משנה **רק את המשתמש של ה־Token**.

**Request Body** (לפחות שדה אחד):
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `fullName` | string | ✘ | 2–100 תווים. רווחים בהתחלה ובסוף מוסרים |
| `phone` | string | ✘ | אותם כללים כמו בהרשמה: 7–19 תווים, ספרות, רווחים ומקפים, `+` בהתחלה. **אי אפשר למחוק** טלפון (`null` נדחה) |
| `address` | string \| null | ✘ | עד 200 תווים, רווחים בהתחלה ובסוף מוסרים. **מחיקה:** `null`, `""` או רווחים בלבד |

**שדות אסורים:** `email`, `role`, `googleId`, `emailVerified`, `password`, `id` וכל שדה אחר. שליחת אחד מהם מחזירה `400`, ושום דבר לא משתנה.

```json
{ "fullName": "נועה לוי-כהן", "phone": "052-7654321", "address": "רחוב הרצל 10, תל אביב" }
```

מחיקת כתובת:
```json
{ "address": null }
```

**Response `200`:**
```json
{
  "user": {
    "id": 2,
    "fullName": "נועה לוי-כהן",
    "email": "noa.levi@example.com",
    "phone": "052-7654321",
    "address": "רחוב הרצל 10, תל אביב",
    "role": "Client",
    "emailVerified": true,
    "googleLinked": false,
    "createdAt": "2026-10-24T19:00:00.000Z"
  }
}
```

**שגיאות:**
| HTTP | code | מתי |
|---|---|---|
| 400 | `VALIDATION_ERROR` | גוף ריק (`Send at least one field to update: fullName, phone or address`), ערך לא תקין (למשל `Address must be at most 200 characters` ב־`field: "address"`), או שדה אסור (`Unrecognized keys: "email"`) |
| 401 | `UNAUTHORIZED` | לא מחובר |

---

### 4.3 Packages – מחירון וחבילות לפי סוג אירוע

**איך זה בנוי:**
- לכל חבילה יש `eventType`: סוג אירוע מסוים, או `null` = **חבילה כללית** שמתאימה לכל סוג (Basic, Premium ו־Luxury הן כלליות).
- **מחיר החבילה הוא מחירון בלבד.** הוא לא נשמר בהזמנה, ולכן שינוי מחיר לא משנה שום הזמנה קיימת. השדה `budget` של הזמנה הוא **תקציב העיצוב** של האירוע, ולא מחיר החבילה. אל תציגי את מחיר החבילה הנוכחי כ"מחיר ששולם" בהזמנה ישנה.
- **אין תשלום באתר:** המחירון להצגה בלבד, והזמנה נעשית ביצירת קשר עם הסטודיו.
- **"מחיקה" = ארכיון:** חבילה בארכיון לא מופיעה במחירון ואי אפשר לבחור בה להזמנה חדשה, אבל הזמנות קיימות ממשיכות להציג אותה.

#### 6. `GET /packages` 🌐

| פרמטר | חובה | ערכים |
|---|---|---|
| `eventType` | ✘ | `Birthday` / `BatMitzvah` / `Brit` / `Corporate` / `Private`. ערך אחר מחזיר `400` |

- **בלי פרמטר:** כל החבילות **הפעילות** (מכל הסוגים, וגם הכלליות).
- **עם `eventType`:** החבילות של הסוג, ואחריהן החבילות הכלליות. כך אפשר להציג בעמוד של סוג אירוע שני חלקים: "חבילות יום הולדת" (`eventType === 'Birthday'`) ו"חבילות כלליות" (`eventType === null`).
- **סדר:** סוג (הכלליות בסוף), אחר כך `sortOrder`, מחיר ו־`id`.

**Response `200`:** `Package[]`
```json
[
  {
    "id": 4,
    "name": "יום הולדת קלאסי",
    "description": "שולחן מתוקים ובלונים בצבעי האירוע",
    "price": 1500,
    "features": ["שולחן מתוקים מעוצב", "קשת בלונים קטנה", "שלט ברכה אישי"],
    "imageUrl": "https://picsum.photos/seed/eventstyle-type-1/800/600",
    "eventType": "Birthday",
    "sortOrder": 1
  },
  {
    "id": 1,
    "name": "Basic",
    "description": "עיצוב שולחן מרכזי, צבעים ואביזרים בסיסיים",
    "price": 1200,
    "features": ["עיצוב שולחן מרכזי", "התאמת צבעים לאירוע", "אביזרים בסיסיים"],
    "imageUrl": "https://picsum.photos/seed/eventstyle-basic/800/600",
    "eventType": null,
    "sortOrder": 0
  }
]
```

> אל תכתבי את מזהי החבילות (`id`) בקוד. טעני אותם מ־`GET /packages` ובני מהם את רשימת הבחירה (`<select>`). בטופס הזמנה, טעני `GET /packages?eventType=<הסוג שנבחר>` – כך יוצגו רק חבילות שמתאימות לסוג.

#### 22. `POST /packages` 👑 – יצירת חבילה

**Request Body:** `PackageInput`
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `name` | string | ✔ | 2–50 תווים. ייחודי בתוך הסוג (או בין החבילות הכלליות) |
| `description` | string | ✔ | 2–500 תווים |
| `price` | number | ✔ | 0 ומעלה, עד 2 ספרות אחרי הנקודה |
| `features` | string[] | ✔ | 1–20 פריטים, כל אחד 1–100 תווים |
| `imageUrl` | string | ✔ | כתובת `https` עד 500 תווים (אין העלאת קובץ לחבילה) |
| `eventType` | EventType \| null | ✔ | סוג אירוע, או `null` לחבילה כללית. **חובה לשלוח** |
| `isActive` | boolean | ✘ | ברירת מחדל `true` |
| `sortOrder` | integer | ✘ | 0–1000, ברירת מחדל `0` |

```json
{
  "name": "יום הולדת קלאסי",
  "description": "שולחן מתוקים ובלונים בצבעי האירוע",
  "price": 1500,
  "features": ["שולחן מתוקים מעוצב", "קשת בלונים קטנה"],
  "imageUrl": "https://picsum.photos/seed/eventstyle-type-1/800/600",
  "eventType": "Birthday",
  "sortOrder": 1
}
```

**Response `201`:** `AdminPackage` (כולל `isActive`, `eventCount: 0`, `createdAt`, `updatedAt`).

#### 23. `PUT /packages/:id` 👑 – עריכת חבילה

- **החלפה מלאה:** שולחים את כל שדות החובה. `isActive` ו־`sortOrder` שלא נשלחו לא משתנים.
- **עדכון מחיר:** משנה רק את המחירון. הזמנות קיימות לא משתנות.
- **החזרה מהארכיון:** `isActive: true`.
- **שינוי `eventType`:**
  - ל־`null` (כללית): תמיד מותר.
  - לסוג מסוים: מותר רק אם **כל** ההזמנות שמשתמשות בחבילה הן מאותו סוג. אחרת `409` עם `details: { "conflictingEvents": 2 }`, ושום דבר לא משתנה.

**Response `200`:** `AdminPackage`.

#### 24. `DELETE /packages/:id` 👑 – העברה לארכיון

- **אין מחיקה פיזית.** החבילה מקבלת `isActive: false`, נעלמת מ־`GET /packages`, ונשארת ב־`GET /admin/packages`.
- **Response `204`**, גם אם החבילה כבר בארכיון.

#### 25. `GET /admin/packages` 👑 – כל החבילות לניהול

| פרמטר | ערכים |
|---|---|
| `eventType` | סוג אירוע, או `general` לחבילות הכלליות בלבד |
| `isActive` | `true` / `false` |

**Response `200`:** `AdminPackage[]`, כולל `eventCount` (כמה הזמנות משתמשות בחבילה), באותו סדר כמו המחירון הציבורי.

**שגיאות בנתיבי הניהול:**
| HTTP | code | מתי |
|---|---|---|
| 400 | `VALIDATION_ERROR` | שדה חסר או לא תקין, שדה לא מוכר, או `id` לא מספרי |
| 401 | `UNAUTHORIZED` | לא מחוברת |
| 403 | `FORBIDDEN` | לקוחה (לא מנהלת) |
| 404 | `NOT_FOUND` | `Package not found` |
| 409 | `CONFLICT` | `A package with this name already exists for this event type`, או שינוי סוג שלא מתאים להזמנות קיימות |

**אחרי פעולת ניהול:** טעני מחדש את `GET /admin/packages`, ואת `GET /packages` אם הוא מוצג באותו מסך.

#### התאמה בין חבילה להזמנה (`POST /events`, `PUT /events/:id`)
| מצב | תוצאה |
|---|---|
| חבילה מסוג ההזמנה, או כללית | ✔ |
| חבילה מסוג אחר | `400`: `Package is for Birthday events and does not match eventType BatMitzvah` |
| חבילה בארכיון בהזמנה חדשה, או מעבר אליה | `400`: `Package is archived and cannot be selected` |
| עריכת הזמנה שכבר משויכת לחבילה בארכיון, בלי להחליף חבילה | ✔ |
| שינוי `eventType` של הזמנה לסוג שלא מתאים לחבילה שלה | `400` (אותה הודעת חוסר התאמה) |

---

### 4.4 Gallery – גלריית עיצובים לפי סוג אירוע

**איך זה בנוי:**
- **גלריה לכל סוג אירוע:** כל פריט שייך לסוג (`category`). גלריה של סוג = `GET /gallery?category=<סוג>`.
- **פרסום / הסתרה:** פריט מוסתר (`isPublished: false`) **לא מופיע באף נתיב ציבורי** (`GET /gallery`, `GET /gallery/summary`). המנהלת רואה אותו ב־`GET /admin/gallery`.
- **תמונות מובילות:** `isFeatured: true`. לדף הבית: `GET /gallery?featured=true&limit=6`.
- **סדר:** `sortOrder` (קטן קודם), ואז החדשים קודם.
- **מחיקה מול הסתרה:** `DELETE` מוחק לצמיתות, כולל הקובץ. להסתרה זמנית משתמשים ב־`PATCH` עם `isPublished: false`.

#### 7. `GET /gallery` 🌐

**Query Parameters:**
| פרמטר | חובה | ערכים | ברירת מחדל | דוגמה |
|---|---|---|---|---|
| `category` | ✘ | EventType | הכול | `?category=BatMitzvah` |
| `featured` | ✘ | `true` / `false` | הכול | `?featured=true` (תמונות מובילות בלבד) |
| `page` | ✘ | מספר שלם, 1 ומעלה | `1` | `?page=2` |
| `limit` | ✘ | מספר שלם, 1–100 (פריטים בעמוד) | `10` | `?limit=6` (למשל "עבודות נבחרות" בדף הבית) |

**Response `200`:** `Paginated<GalleryItem>`: פריטים מפורסמים בלבד, לפי `sortOrder` ואז מהחדש לישן.
```json
{
  "data": [
    {
      "id": 3,
      "title": "בת מצווה בגווני זהב ולבן",
      "category": "BatMitzvah",
      "url": "https://picsum.photos/seed/eventstyle-gallery-3/1200/800",
      "publicId": null,
      "isFeatured": true,
      "sortOrder": 0,
      "createdAt": "2026-10-05T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "totalItems": 10, "totalPages": 1 }
}
```

> ⚠️ **שינוי:** בעבר התשובה הייתה מערך, ובלי `limit` הוחזרו כל התמונות. עכשיו התשובה היא `{ data, pagination }`, ובלי `limit` מוחזרות 10 תמונות. הפריטים עצמם נמצאים ב־`response.data`.

**שגיאות:**
| HTTP | מתי |
|---|---|
| 400 | `category` לא תקין, `featured` שאינו `true`/`false`, `page` קטן מ־1, `limit` מחוץ לטווח 1–100, או מספר לא שלם |

> ⚠️ אל תשלחי פרמטר ריק כמו `?category=`. אם המשתמשת בחרה "הכול", פשוט אל תוסיפי את הפרמטר.

#### 8. `POST /gallery` 👑 – הוספת תמונה לגלריה

`multipart/form-data`. כל הפרטים נמצאים ב[פרק 5](#5-העלאת-תמונות-ל-cloudinary).

**שדות הטופס:**
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `image` | File | ✔ | קובץ אחד: JPEG, PNG או WEBP, עד 5MB |
| `title` | string | ✔ | 2–120 תווים |
| `category` | string | ✔ | EventType |
| `isPublished` | `"true"` / `"false"` | ✘ | ברירת מחדל `"true"`. `"false"` = העלאה כטיוטה מוסתרת |
| `isFeatured` | `"true"` / `"false"` | ✘ | ברירת מחדל `"false"` |
| `sortOrder` | מספר שלם כמחרוזת | ✘ | `"0"`–`"1000"`, ברירת מחדל `"0"` |

> ב־FormData כל הערכים הם מחרוזות: `form.append('isFeatured', 'true')`.

**Response `201`:** `AdminGalleryItem`
```json
{
  "id": 11,
  "title": "שולחן מתוקים לבר מצווה",
  "category": "BatMitzvah",
  "url": "https://res.cloudinary.com/<cloud>/image/upload/v1792909845/eventstyle/gallery/abc123.jpg",
  "publicId": "eventstyle/gallery/abc123",
  "isFeatured": false,
  "sortOrder": 0,
  "isPublished": true,
  "createdAt": "2026-10-25T09:30:00.000Z",
  "updatedAt": "2026-10-25T09:30:00.000Z"
}
```

**שגיאות:** 400, 401, 403, 413, 415, 502, 503. פירוט בפרק 5.4.

#### 9. `DELETE /gallery/:id` 👑 – מחיקה לצמיתות

- **Path:** `id`, מזהה הפריט.
- **Response `204`:** בלי גוף. התמונה נמחקת גם מ־Cloudinary, ואי אפשר לשחזר אותה. **להסתרה בלי מחיקה** השתמשי ב־`PATCH` עם `isPublished: false`.

**שגיאות:**
| HTTP | מתי |
|---|---|
| 400 | `id` לא מספר |
| 401 / 403 | לא מחובר, או לא Admin |
| 404 | `Gallery item not found` |

#### 26. `PATCH /gallery/:id` 👑 – עריכת פריט גלריה

**Request Body (JSON):** `GalleryUpdate`, לפחות שדה אחד. שדה שלא נשלח לא משתנה, **והקובץ עצמו לא משתנה**.
| שדה | טיפוס | כללים |
|---|---|---|
| `title` | string | 2–120 תווים |
| `category` | EventType | העברת התמונה לגלריה של סוג אחר |
| `isPublished` | boolean | `false` = הסתרה מכל הנתיבים הציבוריים, `true` = פרסום |
| `isFeatured` | boolean | תמונה מובילה |
| `sortOrder` | integer | 0–1000 |

```json
{ "isPublished": false }
```

**Response `200`:** `AdminGalleryItem` המעודכן.

**שגיאות:** `400` (גוף ריק, ערך לא תקין, או שדה לא מוכר כמו `url`), `401`, `403`, `404 Gallery item not found`.

#### 27. `GET /gallery/summary` 🌐 – סיכום הגלריות

לדף "הגלריות שלנו": שורה אחת **לכל אחד מ־5 סוגי האירועים**, תמיד באותו סדר.
- `count`: מספר התמונות **המפורסמות** בסוג.
- `cover`: תמונה מובילה אם יש, אחרת הראשונה לפי הסדר. **`null` כשאין תמונות מפורסמות** – הציגי מצב ריק או הסתירי את הסוג.

```json
[
  { "category": "Birthday", "count": 0, "cover": null },
  { "category": "BatMitzvah", "count": 2, "cover": { "id": 3, "title": "בת מצווה בגווני זהב ולבן", "category": "BatMitzvah", "url": "https://...", "publicId": null, "isFeatured": true, "sortOrder": 0, "createdAt": "2026-10-05T10:00:00.000Z" } }
]
```

#### 28. `GET /admin/gallery` 👑 – כל פריטי הגלריה לניהול

| פרמטר | ערכים |
|---|---|
| `category` | EventType |
| `isPublished` | `true` / `false` |
| `isFeatured` | `true` / `false` |
| `page`, `limit` | כמו ב־`GET /gallery` |

**Response `200`:** `Paginated<AdminGalleryItem>`, כולל פריטים מוסתרים, באותו סדר כמו הגלריה הציבורית.

**אחרי פעולת ניהול:** טעני מחדש את `GET /admin/gallery`. אם באותו מסך מוצגת גם הגלריה הציבורית או הסיכום – טעני גם אותם.

---

### 4.5 Events – אירועים

#### 10. `GET /events` 👑 – כל האירועים (טבלת המנהלת)

**Query Parameters (כולם רשות):**
| פרמטר | ערכים | ברירת מחדל | פירוט |
|---|---|---|---|
| `search` | טקסט, עד 100 תווים | – | מחפש **בשם האירוע** או **בשם הלקוח**. חלק מהמילה מספיק, ואין הבדל בין אותיות גדולות לקטנות |
| `eventType` | EventType | – | סינון לפי סוג |
| `status` | EventStatus | – | סינון לפי סטטוס |
| `packageId` | מספר שלם חיובי | – | סינון לפי חבילה |
| `sortBy` | `eventDate` / `budget` / `clientName` | `eventDate` | שדה המיון |
| `sortDir` | `asc` / `desc` | `desc` | כיוון המיון |
| `page` | מספר שלם, 1 ומעלה | `1` | מספר העמוד |
| `limit` | מספר שלם, 1–100 | `10` | אירועים בעמוד |

- **צירוף מסננים:** אפשר לשלב כמה מסננים יחד. כולם חלים ביחד (AND).
- **עמודים:** החלוקה לעמודים נעשית **אחרי** החיפוש, הסינון והמיון. `totalItems` הוא מספר התוצאות שמתאימות לסינון.
- **סדר יציב:** כשיש ערכים זהים (למשל אותו תקציב), השרת ממיין גם לפי `id`. לכן אין כפילויות או דילוגים בין עמודים.
- **שינוי מסנן או מיון:** **חזרי לעמוד 1** (`page=1`). אחרת אפשר להגיע לעמוד שכבר לא קיים.

**דוגמה:**
```
GET /events?search=נועה&status=Planning&sortBy=budget&sortDir=asc&page=1&limit=10
```

**Response `200`:** `Paginated<EventItem>`. כל אירוע כולל `notes`, `package` ו־`photoCount`.
```json
{
  "data": [
  {
    "id": 1,
    "eventName": "יום הולדת 30 לנועה",
    "clientName": "נועה לוי",
    "clientEmail": "noa.levi@example.com",
    "eventType": "Birthday",
    "eventDate": "2026-12-08",
    "location": "אולם הגן, תל אביב",
    "packageId": 2,
    "package": { "id": 2, "name": "Premium" },
    "themeColor": "#F4C2C2",
    "guestCount": 80,
    "budget": 4500,
    "status": "Planning",
    "coverImageUrl": null,
    "notes": "להזמין בלונים בגוון ורוד עתיק",
    "userId": 2,
    "photoCount": 0,
    "createdAt": "2026-10-24T19:00:00.000Z",
    "updatedAt": "2026-10-24T19:00:00.000Z"
  }
  ],
  "pagination": { "page": 1, "limit": 10, "totalItems": 6, "totalPages": 1 }
}
```

> ⚠️ **שינוי:** בעבר התשובה הייתה מערך. עכשיו האירועים נמצאים ב־`response.data`, ומידע העמודים ב־`response.pagination`.

**שגיאות:**
| HTTP | מתי |
|---|---|
| 400 | ערך לא תקין, למשל `sortBy=price`, `status=Done`, `packageId=abc`, `page=0` או `limit=101`, **או פרמטר ריק** כמו `status=` או `page=` |
| 401 / 403 | לא מחובר, או לא Admin |

> ⚠️ **אל תשלחי מסננים ריקים.** `?status=&eventType=` יחזיר `400`. בני את ה־URL רק מהשדות שיש להם ערך. הפונקציה `buildQuery` בפרק 7 עושה זאת.
> 💡 **חיפוש:** החיפוש מתבצע בשרת. בכל שינוי במסנן שלחי בקשה חדשה. בשדה החיפוש כדאי להוסיף השהיה (debounce) של כ־300ms.

#### 11. `GET /events/my` 👤 – האירועים שלי

- מחזיר רק את האירועים שמשויכים למשתמש המחובר (`userId` מה־Token).

**Query Parameters (רשות):**
| פרמטר | ערכים | ברירת מחדל |
|---|---|---|
| `page` | מספר שלם, 1 ומעלה | `1` |
| `limit` | מספר שלם, 1–100 | `10` |

**Response `200`:** `Paginated<EventItem>`, מהתאריך המאוחר למוקדם. אצל לקוח **אין `notes`**.
```json
{
  "data": [
  {
    "id": 2,
    "eventName": "בת המצווה של מאיה",
    "clientName": "נועה לוי",
    "clientEmail": "noa.levi@example.com",
    "eventType": "BatMitzvah",
    "eventDate": "2027-02-22",
    "location": "אחוזת השקמים, רמת גן",
    "packageId": 3,
    "package": { "id": 3, "name": "Luxury" },
    "themeColor": "#D4AF37",
    "guestCount": 250,
    "budget": 18000,
    "status": "New",
    "coverImageUrl": null,
    "userId": 2,
    "photoCount": 0,
    "createdAt": "2026-10-24T19:00:00.000Z",
    "updatedAt": "2026-10-24T19:00:00.000Z"
  }
  ],
  "pagination": { "page": 1, "limit": 10, "totalItems": 2, "totalPages": 1 }
}
```

**שגיאות:**
| HTTP | מתי |
|---|---|
| 400 | `page` או `limit` לא תקינים |
| 401 | לא מחובר |

> לקוחה שעוד לא אימתה את האימייל תקבל `data: []` עם `totalItems: 0`. הציגי הודעה כמו "אמתי את כתובת האימייל כדי לראות את האירועים שלך".

#### 12. `GET /events/:id` 👤 – אירוע בודד

- **Path:** `id`.
- **הרשאה:** Admin רואה כל אירוע. Client רואה רק אירוע שמשויך אליו.

**Response `200`:** `EventItem` עם `photos`. ללקוח בלי `notes`.
```json
{
  "id": 1,
  "eventName": "יום הולדת 30 לנועה",
  "clientName": "נועה לוי",
  "clientEmail": "noa.levi@example.com",
  "eventType": "Birthday",
  "eventDate": "2026-12-08",
  "location": "אולם הגן, תל אביב",
  "packageId": 2,
  "package": { "id": 2, "name": "Premium" },
  "themeColor": "#F4C2C2",
  "guestCount": 80,
  "budget": 4500,
  "status": "Planning",
  "coverImageUrl": null,
  "userId": 2,
  "photos": [
    {
      "id": 7,
      "eventId": 1,
      "url": "https://res.cloudinary.com/<cloud>/image/upload/v1792909845/eventstyle/events/1/xyz.jpg",
      "publicId": "eventstyle/events/1/xyz",
      "createdAt": "2026-10-25T10:00:00.000Z"
    }
  ],
  "createdAt": "2026-10-24T19:00:00.000Z",
  "updatedAt": "2026-10-25T10:00:00.000Z"
}
```

**שגיאות:**
| HTTP | code | מתי |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `id` לא מספר |
| 401 | `UNAUTHORIZED` | לא מחובר |
| 403 | `FORBIDDEN` | `You do not have access to this event`: לקוחה מנסה לפתוח אירוע של מישהו אחר |
| 404 | `NOT_FOUND` | `Event not found` |

#### 13. `POST /events` 👑 – יצירת אירוע

**Request Body:**
| שדה | טיפוס | חובה | כללים |
|---|---|---|---|
| `eventName` | string | ✔ | 2–120 תווים |
| `clientName` | string | ✔ | 2–100 תווים |
| `clientEmail` | string | ✔ | אימייל תקין |
| `eventType` | EventType | ✔ | |
| `eventDate` | string | ✔ | `YYYY-MM-DD`, תאריך שקיים בלוח השנה. אין הגבלה לתאריך עתידי |
| `location` | string | ✔ | 2–200 תווים |
| `packageId` | **number** | ✔ | מזהה של חבילה קיימת |
| `themeColor` | string | ✔ | 1–30 תווים |
| `guestCount` | **number** | ✔ | מספר שלם, 1–100,000 |
| `budget` | **number** | ✔ | 0 ומעלה, עד 2 ספרות אחרי הנקודה |
| `status` | EventStatus | ✘ | ברירת מחדל `New` |
| `coverImageUrl` | string \| null | ✘ | כתובת `http` או `https`, עד 500 תווים. `""` או `null` נשמרים כ־`null` |
| `notes` | string \| null | ✘ | עד 2000 תווים. `""` נשמר כ־`null`. **רק המנהלת רואה את השדה** |

```json
{
  "eventName": "יום הולדת 30 לנועה",
  "clientName": "נועה לוי",
  "clientEmail": "noa.levi@example.com",
  "eventType": "Birthday",
  "eventDate": "2026-12-15",
  "location": "אולם הגן, תל אביב",
  "packageId": 2,
  "themeColor": "#F4C2C2",
  "guestCount": 80,
  "budget": 4500,
  "status": "New",
  "coverImageUrl": null,
  "notes": "להזמין בלונים בגוון ורוד עתיק"
}
```

**Response `201`:** `EventItem` מלא, עם `notes`, `package` ו־`photos: []`.

**שגיאות:**
| HTTP | מתי |
|---|---|
| 400 | Validation. ב־`details` יש רשימת שדות. כולל `{ "field": "packageId", "message": "Package does not exist" }` |
| 401 / 403 | לא מחובר, או לא Admin |

**חשוב:**
- **המרת מספרים:** ערכים מ־`<input>` מגיעים **כמחרוזות**. המירי את `packageId`, `guestCount` ו־`budget` עם `Number(...)` לפני השליחה. מחרוזת כמו `"80"` תחזיר `400 guestCount must be a number`.
- **אין לשלוח `userId`.** השרת מקשר את האירוע לבד לפי `clientEmail`, ורק ללקוחה רשומה **ומאומתת**. אם אין לקוחה כזו, `userId` יהיה `null`. כשהלקוחה תירשם ותאמת את האימייל, הקישור יתבצע אוטומטית.
- **לקוחות לא יוצרות אירועים.** רק המנהלת יוצרת אירועים.

#### 14. `PUT /events/:id` 👑 – עריכת אירוע (החלפה מלאה)

- **Path:** `id`.
- **Body:** אותו גוף ואותם כללים כמו ב־`POST /events`. **חובה לשלוח את כל שדות החובה.**

**Response `200`:** `EventItem` מעודכן, עם `photos`.

**שגיאות:** 400, 401, 403, 404 (`Event not found`).

> ⚠️ **זו החלפה מלאה:**
> - **`status`:** אם לא שולחים אותו, הסטטוס הקיים **נשמר**.
> - **`notes` ו־`coverImageUrl`:** אם לא שולחים אותם, הם **נמחקים** ונשמרים כ־`null`. בטופס העריכה טעני את האירוע עם `GET /events/:id`, מלאי את הטופס בכל הערכים הקיימים, ושלחי את כולם.
> - **הקישור ללקוחה** מחושב מחדש לפי `clientEmail`.
> - **השדות `id`, `package`, `photos`, `userId`, `createdAt` ו־`updatedAt`** אסורים בגוף הבקשה. אם תשלחי את האובייקט שקיבלת מהשרת כמו שהוא, תתקבל שגיאת 400. שלחי רק את שדות `EventInput`.

#### 15. `PATCH /events/:id/status` 👑 – עדכון סטטוס

- **Path:** `id`.
- **Body:**

| שדה | טיפוס | חובה |
|---|---|---|
| `status` | EventStatus | ✔ |

```json
{ "status": "Preparing" }
```

**Response `200`:** `EventItem` מעודכן, עם `photos`.

**שגיאות:** 400 (סטטוס לא תקין), 401, 403, 404.

> אפשר לעבור לכל סטטוס, ולא רק לפי הסדר.

#### 16. `DELETE /events/:id` 👑 – מחיקת אירוע

- **Response `204`:** בלי גוף. **כל התמונות של האירוע נמחקות גם הן**, גם ממסד הנתונים וגם מ־Cloudinary.

**שגיאות:** 400, 401, 403, 404.

> כדאי להציג חלון אישור ("למחוק את האירוע?") לפני המחיקה, כי היא לא הפיכה.

#### 17. `POST /events/:id/photos` 👑 – העלאת תמונות לאירוע

`multipart/form-data`, עם השדה `photos` שמכיל 1–10 קבצים. פירוט בפרק 5.

**Response `201`:** `EventPhoto[]`, רק התמונות החדשות.
```json
[
  {
    "id": 8,
    "eventId": 1,
    "url": "https://res.cloudinary.com/<cloud>/image/upload/v1792909900/eventstyle/events/1/p1.jpg",
    "publicId": "eventstyle/events/1/p1",
    "createdAt": "2026-10-25T10:05:00.000Z"
  }
]
```

**שגיאות:** 400, 401, 403, 404 (האירוע לא קיים), 413, 415, 502, 503.

#### 18. `DELETE /events/:id/photos/:photoId` 👑 – מחיקת תמונת אירוע

- **Path:** `id` (האירוע) ו־`photoId` (התמונה).
- **Response `204`:** בלי גוף.

**שגיאות:**
| HTTP | מתי |
|---|---|
| 400 | `id` או `photoId` לא מספר |
| 401 / 403 | לא מחובר, או לא Admin |
| 404 | `Photo not found for this event`: התמונה לא קיימת, או שייכת לאירוע אחר |

---

### 4.6 System

#### 19. `GET /health` 🌐 – בדיקת פעילות

**Response `200`:**
```json
{ "status": "ok", "database": "ok", "uptimeSeconds": 120, "timestamp": "2026-10-25T09:00:00.000Z" }
```

**Response `503`** (מסד הנתונים לא זמין):
```json
{ "status": "error", "database": "unreachable", "uptimeSeconds": 5, "timestamp": "2026-10-25T09:00:00.000Z" }
```

> שימושי לבדוק שהשרת עובד לפני שמתחילים לפתח. בדרך כלל אין צורך לקרוא לו מתוך האפליקציה.

---

## 5. העלאת תמונות ל־Cloudinary

### 5.1 סיכום

| | גלריה | תמונות אירוע |
|---|---|---|
| Endpoint | `POST /gallery` | `POST /events/:id/photos` |
| הרשאה | 👑 Admin | 👑 Admin |
| סוג הבקשה | `multipart/form-data` | `multipart/form-data` |
| שדה הקובץ | `image`: **קובץ אחד** | `photos`: **1–10 קבצים** באותו שם שדה |
| שדות נוספים | `title`, `category` (חובה). `isPublished`, `isFeatured`, `sortOrder` (רשות) | אין |
| תיקייה ב־Cloudinary | `eventstyle/gallery` | `eventstyle/events/<id>` |
| תגובה | `201` + `AdminGalleryItem` | `201` + `EventPhoto[]` |
| מחיקה | `DELETE /gallery/:id` | `DELETE /events/:id/photos/:photoId` |

### 5.2 מגבלות קבצים

| מגבלה | ערך |
|---|---|
| סוגים מותרים | `image/jpeg`, `image/png`, `image/webp` |
| גודל מקסימלי | 5MB **לכל קובץ** |
| מספר קבצים | עד 10 בבקשה אחת (רק בתמונות אירוע) |
| בדיקת תוכן | השרת בודק את "חתימת הקובץ". קובץ ששמו `.png` אבל הוא לא באמת תמונה יידחה עם 415 |
| עיבוד מחדש | כל תמונה מסובבת לפי כיוון ה־EXIF, מוקטנת עד 2500 פיקסלים בצלע הארוכה, ומקודדת מחדש **בלי מטא־דאטה** (כולל מיקום GPS). תמונה שלא ניתן לפענח נדחית עם 415, ותמונה עם יותר מדי פיקסלים עם 413 |

- **בדיקה מוקדמת:** כדאי לבדוק סוג וגודל כבר בצד הלקוח, לפני השליחה, כדי לחסוך המתנה.
- **סינון בבחירת קבצים:** `<input type="file" accept="image/jpeg,image/png,image/webp">` מסנן את הקבצים כבר בחלון הבחירה.

### 5.3 כללים חשובים בשליחת FormData

1. **אל תגדירי `Content-Type`.** הדפדפן מגדיר אותו לבד, יחד עם ה־`boundary`. אם תגדירי `multipart/form-data` ידנית, השרת לא יצליח לקרוא את הקובץ.
2. שמות השדות חייבים להיות **בדיוק** `image` (גלריה) או `photos` (אירוע). שם אחר יחזיר `400 Upload error: Unexpected file field`.
3. בתמונות אירוע מוסיפים כל קובץ בנפרד, עם אותו שם שדה: `formData.append('photos', file)` בלולאה.
4. ב־`POST /gallery` מותר לשלוח רק את שדות הטקסט `title`, `category`, `isPublished`, `isFeatured` ו־`sortOrder`. שדה אחר יחזיר 400.
5. ההעלאה היא "הכול או כלום": אם אחת התמונות נכשלת, אף תמונה לא נשמרת.

### 5.4 שגיאות העלאה

השרת בודק את הבקשה בסדר הזה:

| שלב | HTTP | code | message לדוגמה |
|---|---|---|---|
| 1. התחברות | 401 | `UNAUTHORIZED` | `Missing Bearer token` |
| 2. תפקיד | 403 | `FORBIDDEN` | `You do not have permission to perform this action` |
| 3. סוג קובץ | 415 | `UNSUPPORTED_FILE_TYPE` | `Unsupported file type. Allowed: image/jpeg, image/png, image/webp` |
| 3. גודל קובץ | 413 | `FILE_TOO_LARGE` | `File is too large (max 5MB)` |
| 3. שם שדה שגוי / יותר מ־10 קבצים | 400 | `VALIDATION_ERROR` | `Upload error: Unexpected file field` או `Upload error: Too many files` |
| 3. אין קובץ | 400 | `VALIDATION_ERROR` | `Image file is required in field "image"` / `At least one image file is required in field "photos"` |
| 4. חתימת קובץ | 415 | `UNSUPPORTED_FILE_TYPE` | `File "x.png" is not a valid image/png image` |
| 4. עיבוד התמונה | 415 / 413 | `UNSUPPORTED_FILE_TYPE` / `FILE_TOO_LARGE` | `File "x.jpg" could not be processed as an image` / `Image "x.jpg" has too many pixels` |
| 5. שדות טקסט (גלריה) | 400 | `VALIDATION_ERROR` | `details: [{ "field": "title", ... }]` |
| 6. האירוע לא קיים | 404 | `NOT_FOUND` | `Event not found` |
| 7. Cloudinary לא מוגדר בשרת | 503 | `STORAGE_NOT_CONFIGURED` | `Image storage is not configured on the server ...` |
| 7. Cloudinary דחה את ההעלאה | 502 | `UPLOAD_FAILED` | `Image upload failed, please try again later` |

### 5.5 הצגת תמונות ב־React

- **השדה להצגה:** `url`. כתובת `https` מלאה, ציבורית. אפשר לשים אותה ישירות ב־`<img src>`, בלי Token.
- **שימי לב:** "מוסתרת" (`isPublished: false`) פירושו שהתמונה לא מופיעה בנתיבים הציבוריים. הקובץ עצמו עדיין נגיש למי שמחזיק את הקישור – הסתרה אינה הגנה על תמונה פרטית.
- **`publicId`:** מזהה פנימי של Cloudinary. לא צריך אותו לתצוגה או למחיקה, כי המחיקה נעשית לפי `id`.
- **נתוני ה־Seed:** תמונות הגלריה וחבילות ה־Seed משתמשות בכתובות `picsum.photos` עם `publicId: null`. הן מוצגות בדיוק באותה דרך.
- **`coverImageUrl` של אירוע:** טקסט חופשי (כתובת URL) שהמנהלת מזינה בטופס. **אין Endpoint נפרד להעלאת תמונת שער.** אפשרות אחת: להעלות תמונה לאירוע ואז להעתיק את ה־`url` שלה ל־`coverImageUrl` בעריכה.

```tsx
<img src={item.url} alt={item.title} loading="lazy" />
```

**טיפ (רשות): תמונה מוקטנת מ־Cloudinary.** אפשר להוסיף הוראת שינוי גודל לכתובת. זה עובד רק לכתובות Cloudinary:
```ts
export function thumb(url: string, width = 600): string {
  return url.includes('res.cloudinary.com') && url.includes('/upload/')
    ? url.replace('/upload/', `/upload/w_${width},c_fill,q_auto,f_auto/`)
    : url;
}
// <img src={thumb(photo.url, 400)} />
```

### 5.6 מחיקת תמונות

| מה | Endpoint | תשובה |
|---|---|---|
| פריט גלריה | `DELETE /gallery/:id` | `204` |
| תמונת אירוע | `DELETE /events/:id/photos/:photoId` | `204` |
| כל התמונות של אירוע | נמחקות אוטומטית ב־`DELETE /events/:id` | `204` |

- המחיקה מוחקת גם את הרשומה וגם את הקובץ ב־Cloudinary.
- **אחרי מחיקה מוצלחת,** הסירי את הפריט מה־State לפי `id`.

---

## 6. טיפול בשגיאות

### 6.1 המבנה האחיד

**כל** שגיאה מהשרת מגיעה במבנה הזה:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "guestCount", "message": "guestCount must be greater than 0" },
      { "field": "clientEmail", "message": "Invalid email address" }
    ]
  }
}
```

- **`code`:** קבוע ובאנגלית. **לפיו מחליטים** מה לעשות בקוד.
- **`message`:** הסבר באנגלית למפתחת. עדיף להציג למשתמשת הודעה בעברית לפי `code`.
- **`details`:** לא תמיד קיים. התוכן שלו תלוי בסוג השגיאה (ראי 6.3).

### 6.2 כל קודי השגיאה

| HTTP | `code` | מתי | מה לעשות בצד הלקוח |
|---|---|---|---|
| 200 / 201 | – | הצלחה (201 = נוצר) | |
| 204 | – | מחיקה הצליחה. **אין גוף תשובה** | אל תקראי ל־`response.json()`. הסירי את הפריט מהרשימה |
| 400 | `VALIDATION_ERROR` | קלט לא תקין: Zod, JSON שבור, פרמטר לא תקין או בעיה בהעלאה | הציגי שגיאה ליד כל שדה לפי `details[].field` |
| 400 | `INVALID_CODE` | קוד אימות שגוי, או שאין קוד פעיל | הציגי את `details.attemptsLeft` אם קיים, והציעי "שלחי קוד חדש" |
| 400 | `CODE_EXPIRED` | עברו 10 דקות | "הקוד פג תוקף" + כפתור שליחה חוזרת |
| 401 | `UNAUTHORIZED` | אין Token, ה־Token לא תקין או פג תוקף, או שהמשתמש נמחק | מחקי את ה־Token ועברי ל־`/login` |
| 401 | `INVALID_CREDENTIALS` | אימייל או סיסמה שגויים בהתחברות (גם למשתמש שנרשם רק עם Google) | "אימייל או סיסמה שגויים". **לא** לבצע התנתקות אוטומטית |
| 401 | `GOOGLE_AUTH_FAILED` | טוקן Google לא תקין או פג תוקף, או אימייל לא מאומת ב־Google | "ההתחברות עם Google נכשלה, נסי שוב". **לא** לבצע התנתקות אוטומטית |
| 403 | `FORBIDDEN` | מחובר, אבל אין הרשאה: לקוחה בנתיב של מנהלת, או אירוע של מישהו אחר | "אין לך הרשאה", או חזרה לדף הקודם |
| 404 | `NOT_FOUND` | הרשומה או הנתיב לא קיימים | "לא נמצא" |
| 409 | `CONFLICT` | האימייל כבר רשום, או כבר מאומת. ב־Google: חשבון קיים שאי אפשר לקשר אוטומטית (ראי 2.6) | הודעה מתאימה, למשל קישור להתחברות עם סיסמה. אפשר להציג את `message` |
| 413 | `FILE_TOO_LARGE` | קובץ גדול מ־5MB, או גוף JSON גדול מ־100KB | "הקובץ גדול מדי (עד 5MB)" |
| 415 | `UNSUPPORTED_FILE_TYPE` | הקובץ אינו JPEG, PNG או WEBP, או שאינו תמונה אמיתית | "ניתן להעלות רק JPEG, PNG או WEBP" |
| 429 | `TOO_MANY_REQUESTS` | יותר מדי בקשות | אם יש `details.retryAfterSeconds`, הציגי ספירה לאחור. אחרת: "נסי שוב בעוד כמה דקות" |
| 500 | `INTERNAL_ERROR` | תקלה לא צפויה בשרת | "אירעה שגיאה, נסי שוב" |
| 502 | `UPLOAD_FAILED` | Cloudinary דחה את ההעלאה | "העלאת התמונה נכשלה, נסי שוב" |
| 502 | `GOOGLE_UNAVAILABLE` | השרת לא הצליח לפנות ל־Google לאימות | "נסי שוב בעוד רגע" |
| 503 | `STORAGE_NOT_CONFIGURED` | Cloudinary לא מוגדר בשרת | "העלאת תמונות אינה זמינה כרגע" |
| 503 | `GOOGLE_AUTH_NOT_CONFIGURED` | `GOOGLE_CLIENT_ID` לא מוגדר בשרת | "התחברות עם Google אינה זמינה כרגע" |
| – | (אין תשובה) | השרת כבוי, או שהבקשה נחסמה ב־CORS | fetch זורק `TypeError`. הציגי "אין חיבור לשרת" |

### 6.3 מבנה `details` לפי סוג השגיאה

| מקרה | `details` |
|---|---|
| Zod Validation | מערך: `[{ "field": "eventDate", "message": "eventDate must be a valid date in format YYYY-MM-DD" }]` |
| שדה מיותר בגוף | `[{ "field": "", "message": "Unrecognized keys: \"userId\"" }]` (השדה `field` ריק) |
| חבילה לא קיימת | `[{ "field": "packageId", "message": "Package does not exist" }]` |
| קוד אימות שגוי | אובייקט: `{ "attemptsLeft": 3 }` |
| המתנה לשליחה חוזרת | אובייקט: `{ "retryAfterSeconds": 42 }` |
| JSON שבור, בעיית העלאה, 401, 403, 404 | אין `details` |

> `field` של שדה מקונן מופיע עם נקודה, למשל `"a.b"`. אצלנו כל השדות שטוחים, ולכן `field` הוא תמיד שם השדה עצמו.

### 6.4 שגיאות Validation נפוצות בטופס אירוע

| שדה | הודעת השרת | סיבה שכיחה |
|---|---|---|
| `guestCount` | `guestCount must be a number` | נשלח כמחרוזת מה־input |
| `guestCount` | `guestCount must be greater than 0` | 0 או מספר שלילי |
| `guestCount` | `guestCount must be a whole number` | מספר עשרוני |
| `budget` | `budget cannot be negative` | ערך שלילי |
| `budget` | `budget can have at most 2 decimal places` | למשל `100.555` |
| `packageId` | `packageId must be a number` / `Package does not exist` | מחרוזת, או חבילה שנמחקה |
| `eventDate` | `eventDate must be a valid date in format YYYY-MM-DD` | פורמט אחר, או תאריך שלא קיים כמו `2026-02-30` |
| `eventType` / `status` | `Must be one of: Birthday, BatMitzvah, ...` | ערך לא מהרשימה |
| `coverImageUrl` | `Must be a valid http(s) URL` | טקסט שאינו כתובת |
| `eventName` | `Event name must be at least 2 characters` | קצר מדי |

### 6.5 מילון הודעות בעברית (רשות)

```ts
export const ERROR_MESSAGES_HE: Record<string, string> = {
  VALIDATION_ERROR: 'יש שדות לא תקינים בטופס',
  INVALID_CREDENTIALS: 'אימייל או סיסמה שגויים',
  INVALID_CODE: 'קוד האימות שגוי',
  CODE_EXPIRED: 'קוד האימות פג תוקף. בקשי קוד חדש',
  UNAUTHORIZED: 'יש להתחבר מחדש',
  FORBIDDEN: 'אין לך הרשאה לפעולה הזו',
  NOT_FOUND: 'הפריט לא נמצא',
  CONFLICT: 'כתובת האימייל כבר רשומה במערכת',
  TOO_MANY_REQUESTS: 'יותר מדי ניסיונות. נסי שוב בעוד מעט',
  FILE_TOO_LARGE: 'הקובץ גדול מדי (עד 5MB)',
  UNSUPPORTED_FILE_TYPE: 'ניתן להעלות רק תמונות JPEG, PNG או WEBP',
  UPLOAD_FAILED: 'העלאת התמונה נכשלה. נסי שוב',
  STORAGE_NOT_CONFIGURED: 'העלאת תמונות אינה זמינה כרגע',
  GOOGLE_AUTH_FAILED: 'ההתחברות עם Google נכשלה. נסי שוב',
  GOOGLE_UNAVAILABLE: 'לא ניתן להתחבר ל־Google כרגע. נסי שוב בעוד רגע',
  GOOGLE_AUTH_NOT_CONFIGURED: 'התחברות עם Google אינה זמינה כרגע',
  INTERNAL_ERROR: 'אירעה שגיאה בשרת. נסי שוב',
  NETWORK_ERROR: 'אין חיבור לשרת',
};
```

---

## 7. דוגמאות מעשיות ל־React

> הדוגמאות כתובות ב־TypeScript ומשתמשות בטיפוסים מפרק 3.2. הן נקודת פתיחה, וכדאי להתאים אותן למבנה שבחרת.

### 7.1 `apiClient` עם fetch

```ts
// src/api/apiClient.ts
import type { ApiErrorBody } from '../types/api';

const API_URL = import.meta.env.VITE_API_URL;
const TOKEN_KEY = 'eventstyle_token';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** שגיאה אחידה לכל הבקשות */
export class ApiError extends Error {
  constructor(
    public status: number,       // 0 = אין חיבור לשרת
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** אפשר לרשום כאן פעולה שתרוץ כשמתקבל 401 (למשל התנתקות ומעבר ל־/login) */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: () => void) => { onUnauthorized = handler; };

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;            // אובייקט JSON או FormData
};

export async function apiRequest<T>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStorage.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  // ב־FormData לא מגדירים Content-Type. הדפדפן מגדיר אותו לבד

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }

  if (response.status === 204) return undefined as T;   // מחיקה: אין גוף

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    const apiError = new ApiError(
      response.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Unexpected error',
      err?.details,
    );
    // 401 בהתחברות (INVALID_CREDENTIALS) אינו סימן לפקיעת התחברות
    if (response.status === 401 && apiError.code === 'UNAUTHORIZED') {
      tokenStorage.clear();
      onUnauthorized?.();
    }
    throw apiError;
  }
  return data as T;
}

/** בונה Query String רק מהשדות שיש להם ערך (מונע 400 על פרמטרים ריקים) */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.append(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

/** הופך details של Validation לאובייקט { שם שדה: הודעה } לתצוגה בטופס */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(
    (error.details as { field: string; message: string }[]).map((d) => [d.field || '_form', d.message]),
  );
}
```

### 7.2 פונקציות API לכל ה־Endpoints

```ts
// src/api/endpoints.ts
import { apiRequest, buildQuery } from './apiClient';
import type {
  AuthResult, GoogleAuthResult, User, ProfileUpdate, Package, GalleryItem, GalleryFilters,
  EventItem, EventInput, EventFilters, EventPhoto, EventStatus, EventType, PageParams, Paginated,
} from '../types/api';

export const authApi = {
  register: (data: { fullName: string; email: string; phone: string; password: string }) =>
    apiRequest<AuthResult & { message: string; verificationEmailSent: boolean }>('/auth/register', { method: 'POST', body: data }),
  verifyEmail: (email: string, code: string) =>
    apiRequest<AuthResult & { message: string; linkedEventsCount: number }>('/auth/verify-email', { method: 'POST', body: { email, code } }),
  resendCode: (email: string) =>
    apiRequest<{ message: string }>('/auth/resend-code', { method: 'POST', body: { email } }),
  login: (email: string, password: string) =>
    apiRequest<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }),
  /** idToken = ה־credential שהתקבל מכפתור Google */
  google: (idToken: string) =>
    apiRequest<GoogleAuthResult>('/auth/google', { method: 'POST', body: { idToken } }),
  me: () => apiRequest<{ user: User }>('/auth/me'),
  updateMe: (data: ProfileUpdate) => apiRequest<{ user: User }>('/auth/me', { method: 'PATCH', body: data }),
};

export const packagesApi = {
  list: () => apiRequest<Package[]>('/packages'),
};

export const galleryApi = {
  list: (params: GalleryFilters = {}) =>
    apiRequest<Paginated<GalleryItem>>(`/gallery${buildQuery({ ...params })}`),
  add: (image: File, title: string, category: EventType) => {
    const form = new FormData();
    form.append('image', image);
    form.append('title', title);
    form.append('category', category);
    return apiRequest<GalleryItem>('/gallery', { method: 'POST', body: form });
  },
  remove: (id: number) => apiRequest<void>(`/gallery/${id}`, { method: 'DELETE' }),
};

export const eventsApi = {
  list: (filters: EventFilters = {}) => apiRequest<Paginated<EventItem>>(`/events${buildQuery({ ...filters })}`),
  my: (params: PageParams = {}) => apiRequest<Paginated<EventItem>>(`/events/my${buildQuery({ ...params })}`),
  get: (id: number) => apiRequest<EventItem>(`/events/${id}`),
  create: (data: EventInput) => apiRequest<EventItem>('/events', { method: 'POST', body: data }),
  update: (id: number, data: EventInput) => apiRequest<EventItem>(`/events/${id}`, { method: 'PUT', body: data }),
  updateStatus: (id: number, status: EventStatus) =>
    apiRequest<EventItem>(`/events/${id}/status`, { method: 'PATCH', body: { status } }),
  remove: (id: number) => apiRequest<void>(`/events/${id}`, { method: 'DELETE' }),
  addPhotos: (id: number, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append('photos', file));   // אותו שם שדה לכל קובץ
    return apiRequest<EventPhoto[]>(`/events/${id}/photos`, { method: 'POST', body: form });
  },
  removePhoto: (id: number, photoId: number) =>
    apiRequest<void>(`/events/${id}/photos/${photoId}`, { method: 'DELETE' }),
};

/** ממיר אירוע מהשרת לגוף תקין ל־PUT (רק שדות מותרים, כולל notes ו־coverImageUrl הקיימים) */
export function toEventInput(e: EventItem): EventInput {
  return {
    eventName: e.eventName, clientName: e.clientName, clientEmail: e.clientEmail,
    eventType: e.eventType, eventDate: e.eventDate, location: e.location,
    packageId: e.packageId, themeColor: e.themeColor, guestCount: e.guestCount,
    budget: e.budget, status: e.status, coverImageUrl: e.coverImageUrl, notes: e.notes ?? null,
  };
}
```

### 7.3 שליחת GET ו־POST: שימוש בסיסי

```ts
// GET – רשימת חבילות (ללא Token)
const packages = await packagesApi.list();

// GET – טבלת מנהלת עם חיפוש, סינון, מיון ועמוד (נבנה רק מהשדות שמולאו)
const { data: events, pagination } = await eventsApi.list({
  search: 'נועה', status: 'Planning', sortBy: 'budget', sortDir: 'asc', page: 1, limit: 10,
});
// → GET /events?search=%D7%A0...&status=Planning&sortBy=budget&sortDir=asc&page=1&limit=10
// events = מערך האירועים בעמוד, pagination.totalPages = מספר העמודים

// POST – יצירת אירוע. המרת ערכי input למספרים!
const created = await eventsApi.create({
  ...form,
  packageId: Number(form.packageId),
  guestCount: Number(form.guestCount),
  budget: Number(form.budget),
});
```

### 7.4 שליחת JWT

ה־`apiClient` מוסיף את `Authorization: Bearer <token>` **אוטומטית** לכל בקשה, אם קיים Token שמור. אין צורך להוסיף אותו ידנית בכל קריאה.

כך זה נראה בבקשה עצמה:
```
GET /api/events/my HTTP/1.1
Host: localhost:4000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 7.5 התחברות, הרשמה ואימות

```tsx
// דוגמה: טיפול בשליחת טופס התחברות, עם Loading ו־Error
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

async function handleLogin(email: string, password: string) {
  setLoading(true);
  setError(null);
  try {
    const { token, user } = await authApi.login(email, password);
    tokenStorage.set(token);
    setUser(user);                         // State גלובלי של המשתמש, לפי הבחירה שלך
    if (!user.emailVerified) navigate('/verify-email', { state: { email: user.email } });
    else navigate(user.role === 'Admin' ? '/admin/events' : '/my-events');
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'INTERNAL_ERROR';
    setError(ERROR_MESSAGES_HE[code] ?? ERROR_MESSAGES_HE.INTERNAL_ERROR);
  } finally {
    setLoading(false);
  }
}
// <button type="submit" disabled={loading}>{loading ? 'מתחברת...' : 'התחברות'}</button>
```

```ts
// הרשמה → שמירת Token → מעבר למסך הקוד
const res = await authApi.register({ fullName, email, phone, password });
tokenStorage.set(res.token);
setUser(res.user);
navigate('/verify-email', { state: { email: res.user.email, emailSent: res.verificationEmailSent } });

// אימות קוד → החלפת Token
try {
  const res = await authApi.verifyEmail(email, code.trim());
  tokenStorage.set(res.token);
  setUser(res.user);
} catch (e) {
  if (e instanceof ApiError && e.code === 'INVALID_CODE') {
    const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
    setError(left !== undefined ? `קוד שגוי. נותרו ${left} ניסיונות` : 'הקוד אינו תקף. בקשי קוד חדש');
  }
}

// שליחה חוזרת, עם ספירה לאחור
try {
  await authApi.resendCode(email);
  setSecondsLeft(60);
} catch (e) {
  const wait = e instanceof ApiError ? (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds : undefined;
  if (wait) setSecondsLeft(wait);
}

// טעינת האפליקציה: בדיקה אם ה־Token השמור עדיין תקף
useEffect(() => {
  if (!tokenStorage.get()) return;
  authApi.me().then(({ user }) => setUser(user)).catch(() => tokenStorage.clear());
}, []);

// התנתקות (אין Endpoint): ניקוי בצד הלקוח בלבד
function logout() {
  tokenStorage.clear();
  setUser(null);
  navigate('/');
}
```

### 7.6 העלאת תמונה

```tsx
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

async function handleUpload(eventId: number, fileList: FileList | null) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0 || files.length > 10) return setError('בחרי בין 1 ל־10 תמונות');
  if (files.some((f) => !ALLOWED.includes(f.type))) return setError('ניתן להעלות רק JPEG, PNG או WEBP');
  if (files.some((f) => f.size > MAX_SIZE)) return setError('כל קובץ חייב להיות עד 5MB');

  setUploading(true);
  setError(null);
  try {
    const newPhotos = await eventsApi.addPhotos(eventId, files);
    setPhotos((prev) => [...prev, ...newPhotos]);          // הוספה לסוף הרשימה
  } catch (e) {
    setError(ERROR_MESSAGES_HE[e instanceof ApiError ? e.code : 'INTERNAL_ERROR']);
  } finally {
    setUploading(false);
  }
}

// <input type="file" multiple accept="image/jpeg,image/png,image/webp"
//        onChange={(e) => handleUpload(event.id, e.target.files)} disabled={uploading} />
// {photos.map((p) => <img key={p.id} src={p.url} alt="" loading="lazy" />)}
```

### 7.7 Loading ו־Error בטעינת נתונים

```tsx
function MyEventsList() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;                 // מונע עדכון State אחרי יציאה מהמסך
    eventsApi.my()
      .then((res) => { if (!cancelled) setEvents(res.data); })   // הרשימה נמצאת ב־data
      .catch((e) => { if (!cancelled) setError(ERROR_MESSAGES_HE[e instanceof ApiError ? e.code : 'INTERNAL_ERROR']); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);                                  // מערך תלויות ריק – בקשה אחת בלבד

  if (loading) return <p>טוען...</p>;
  if (error) return <p role="alert">{error}</p>;
  if (events.length === 0) return <p>אין עדיין אירועים להצגה</p>;
  return <ul>{events.map((e) => <li key={e.id}>{e.eventName} – {e.status}</li>)}</ul>;
}
```

> ⚠️ ב־`useEffect` שתלוי במסננים (`[filters]`), ודאי שהאובייקט לא נוצר מחדש בכל רינדור. אחרת תיווצר לולאת בקשות אינסופית, שעלולה להגיע ל־`429`.

### 7.8 חלופה: Axios

```ts
// src/api/axiosClient.ts   (npm install axios)
import axios from 'axios';
import { ApiError, tokenStorage } from './apiClient';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;                            // ב־FormData, Axios מגדיר Content-Type לבד
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (!err.response) return Promise.reject(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server'));
    const e = err.response.data?.error;
    if (err.response.status === 401 && e?.code === 'UNAUTHORIZED') tokenStorage.clear();
    return Promise.reject(new ApiError(err.response.status, e?.code ?? 'INTERNAL_ERROR', e?.message ?? 'Error', e?.details));
  },
);

// שימוש:
// const { data } = await api.get<Paginated<EventItem>>('/events', { params: { status: 'Planning', page: 1 } });
// data.data = האירועים, data.pagination = מידע העמודים
// ⚠️ גם ב־Axios: אל תעבירי ב־params ערכים ריקים (''). Axios משמיט רק undefined ו־null.
```

### 7.9 התחברות עם Google

**התקנה (בפרויקט ה־React):**
```
npm install @react-oauth/google
```
הספרייה עוטפת את Google Identity Services, הספרייה הרשמית של Google לכפתור ההתחברות.

**משתנה סביבה ב־React** (`.env.development`). זה אותו Client ID שמוגדר בשרת, וההגדרה מוסברת בפרק 12:
```
VITE_GOOGLE_CLIENT_ID=<ה־Client ID שלך>.apps.googleusercontent.com
```

**עטיפת האפליקציה** (`main.tsx`):
```tsx
import { GoogleOAuthProvider } from '@react-oauth/google';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
    <App />
  </GoogleOAuthProvider>,
);
```

**הכפתור** (במסך ההתחברות ובמסך ההרשמה):
```tsx
import { GoogleLogin } from '@react-oauth/google';

<GoogleLogin
  onSuccess={async ({ credential }) => {
    if (!credential) return setError(ERROR_MESSAGES_HE.GOOGLE_AUTH_FAILED);
    setLoading(true);
    setError(null);
    try {
      const { token, user, isNewUser } = await authApi.google(credential);  // credential = ID Token
      tokenStorage.set(token);              // אותו JWT כמו בהתחברות רגילה
      setUser(user);
      if (!user.emailVerified) navigate('/verify-email', { state: { email: user.email } });
      else if (isNewUser && !user.phone) navigate('/profile');   // הצעה להשלים טלפון (רשות)
      else navigate(user.role === 'Admin' ? '/admin/events' : '/my-events');
    } catch (e) {
      // 409: חשבון קיים שלא ניתן לקשר. ההודעה מהשרת מסבירה מה לעשות
      if (e instanceof ApiError && e.code === 'CONFLICT') setError('קיים כבר חשבון עם האימייל הזה. התחברי עם אימייל וסיסמה');
      else setError(ERROR_MESSAGES_HE[e instanceof ApiError ? e.code : 'INTERNAL_ERROR']);
    } finally {
      setLoading(false);
    }
  }}
  onError={() => setError(ERROR_MESSAGES_HE.GOOGLE_AUTH_FAILED)}
  text="continue_with"
  locale="he"
/>
```

**התנתקות:**
```ts
import { googleLogout } from '@react-oauth/google';

function logout() {
  tokenStorage.clear();
  googleLogout();          // מונע התחברות אוטומטית חוזרת עם Google. בטוח גם למשתמש בלי Google
  setUser(null);
  navigate('/');
}
```

> ⚠️ **חשוב:**
> - **מה לשלוח לשרת:** שלחי את `credential` בדיוק כמו שהתקבל. אל תפענחי אותו בעצמך ואל תשמרי אותו. השרת מאמת אותו.
> - **אל תשתמשי ב־`useGoogleLogin`:** הוא מחזיר Access Token ולא ID Token, ולכן לא מתאים לשרת שלנו. השתמשי ברכיב `<GoogleLogin>`.

### 7.10 עריכת פרופיל

```tsx
function ProfileForm({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const body: ProfileUpdate = { fullName };
      if (phone.trim()) body.phone = phone;      // אי אפשר לשלוח טלפון ריק
      const { user: updated } = await authApi.updateMe(body);
      onSaved(updated);                          // עדכון המשתמש ב־State הגלובלי
      setMessage('הפרטים נשמרו');
    } catch (err) {
      setErrors(fieldErrors(err));               // { fullName: '...', phone: '...' }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={user.email} readOnly />      {/* אימייל – לקריאה בלבד */}
      {user.googleLinked && <span>מחובר עם Google</span>}
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      {errors.fullName && <p role="alert">{errors.fullName}</p>}
      <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
      {errors.phone && <p role="alert">{errors.phone}</p>}
      <button type="submit" disabled={saving}>{saving ? 'שומרת...' : 'שמירה'}</button>
      {message && <p>{message}</p>}
    </form>
  );
}
```

### 7.11 חלוקה לעמודים (Pagination)

```tsx
function AdminEventsTable() {
  const [filters, setFilters] = useState<EventFilters>({ sortBy: 'eventDate', sortDir: 'desc' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<EventItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    eventsApi.list({ ...filters, page, limit: 10 })
      .then((res) => { if (!cancelled) setResult(res); })
      .catch((e) => { if (!cancelled) setError(ERROR_MESSAGES_HE[e instanceof ApiError ? e.code : 'INTERNAL_ERROR']); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, page]);                      // filters הוא State, כך שאין לולאה אינסופית

  /** כל שינוי במסנן או במיון מחזיר לעמוד 1 */
  const updateFilters = (changes: Partial<EventFilters>) => {
    setFilters((prev) => ({ ...prev, ...changes }));
    setPage(1);
  };

  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p>טוען...</p>;
  const { data, pagination } = result;

  return (
    <>
      {/* ... שדות חיפוש וסינון שקוראים ל־updateFilters ... */}
      {data.length === 0 ? <p>לא נמצאו אירועים</p> : <table>{/* ... שורה לכל אירוע ב־data ... */}</table>}

      <nav aria-label="עמודים">
        <button disabled={loading || pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>הקודם</button>
        <span>עמוד {pagination.page} מתוך {Math.max(pagination.totalPages, 1)} ({pagination.totalItems} אירועים)</span>
        <button disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}>הבא</button>
      </nav>
    </>
  );
}
```

**כללים לעמודים:**
- **מספרים:** `page` מתחיל ב־1. `totalPages` הוא 0 כשאין תוצאות, ולכן הדוגמה מציגה "עמוד 1 מתוך 1".
- **עמוד ריק:** עמוד שאחרי הסוף מחזיר `data: []` ולא שגיאה. אם מחקת את הפריט האחרון בעמוד, חזרי עמוד אחד אחורה.
- **שינוי מסנן או מיון:** חזרי ל־`page = 1`.
- **"טען עוד" (Infinite scroll):** אפשר גם כך. מוסיפים את `res.data` לסוף הרשימה הקיימת כל עוד `page < totalPages`.

---

## 8. מיפוי מסכים ל־API

### 8.1 טבלת מסכים

| מסך (נתיב מוצע) | מטרה | Endpoints | נתונים להצגה | פעולות המשתמש | הרשאה |
|---|---|---|---|---|---|
| **דף הבית** `/` | היכרות עם הסטודיו | `GET /gallery?featured=true&limit=6`, `GET /packages` | עבודות נבחרות (`data[].url`, `data[].title`), תקציר חבילות (`name`, `price`) | מעבר לגלריה, לחבילות, להרשמה או להתחברות | 🌐 |
| **הגלריות** `/gallery` | בחירת גלריה לפי סוג אירוע | `GET /gallery/summary` | כרטיס לכל סוג: `cover.url`, שם הסוג בעברית, `count`. סוג עם `cover: null` – מצב ריק או הסתרה | מעבר לגלריה של סוג | 🌐 |
| **גלריה של סוג** `/gallery/:category` | הצגת עבודות של סוג אירוע | `GET /gallery?category=...&page=...&limit=...` | תמונות (`url`, `title`) + פקדי עמודים או "טען עוד" | מעבר בין עמודים | 🌐 |
| **חבילות** `/packages` | מחירון לפי סוג אירוע | `GET /packages?eventType=...` | בחירת סוג אירוע, ואז `name`, `description`, `price`, `features[]`, `imageUrl`. חלוקה ל"חבילות הסוג" ו"חבילות כלליות" לפי `eventType`. הסבר שהזמנה נעשית ביצירת קשר | בחירת סוג אירוע | 🌐 |
| **ניהול חבילות** `/admin/packages` | ניהול המחירון | `GET /admin/packages`, `POST /packages`, `PUT /packages/:id`, `DELETE /packages/:id` | טבלה: שם, סוג (או "כללית"), מחיר, `sortOrder`, פעילה/ארכיון, `eventCount` | יצירה, עריכה ועדכון מחיר, שינוי סדר, העברה לארכיון והחזרה | 👑 |
| **הרשמה** `/register` | פתיחת חשבון לקוחה | `POST /auth/register`, `POST /auth/google` | טופס: `fullName`, `email`, `phone`, `password` + שגיאות שדה, וכפתור "המשך עם Google" | שליחת טופס ואז מעבר לאימות, או הרשמה עם Google | 🌐 |
| **אימות אימייל** `/verify-email` | הזנת קוד בן 6 ספרות | `POST /auth/verify-email`, `POST /auth/resend-code` | אימייל, שדה קוד, ניסיונות שנותרו, ספירה לאחור | אימות, שליחה חוזרת | 🌐 (אחרי הרשמה, התחברות, או התחברות Google עם כתובת שאינה Gmail) |
| **התחברות** `/login` | כניסה למערכת | `POST /auth/login`, `POST /auth/google` | טופס: `email`, `password`, וכפתור "המשך עם Google" | התחברות עם סיסמה או עם Google. אם `emailVerified=false`, מעבר לאימות | 🌐 |
| **טעינת האפליקציה** (ללא מסך) | שחזור התחברות אחרי רענון | `GET /auth/me` | – | – | Token שמור |
| **הפרופיל שלי** `/profile` | צפייה בפרטים ועריכתם | `GET /auth/me`, `PATCH /auth/me` | `fullName`, `phone`, `address` (ניתנים לעריכה), `email` (לקריאה בלבד), `role`, `emailVerified`, `googleLinked` | שמירת שם, טלפון וכתובת, ומחיקת כתובת | 👤 (Client או Admin) |
| **האירועים שלי** `/my-events` | הלקוחה רואה את האירועים שלה | `GET /events/my?page=...&limit=...` | `eventName`, `eventDate`, `eventType`, `status`, `package.name`, `photoCount` + פקדי עמודים | מעבר לפרטי אירוע, מעבר בין עמודים | 👤 |
| **פרטי האירוע שלי** `/my-events/:id` | סטטוס ההכנות ותמונות | `GET /events/:id` | כל פרטי האירוע (בלי `notes`), `status` כפס התקדמות, `photos[]` | צפייה בתמונות | 👤 בעלת האירוע |
| **ניהול אירועים** `/admin/events` | טבלת כל האירועים | `GET /events?...&page=...&limit=...`, `GET /packages` (למסנן החבילה), `PATCH /events/:id/status`, `DELETE /events/:id` | טבלה: שם אירוע, לקוח, תאריך, סוג, חבילה, תקציב, סטטוס, מספר תמונות + "עמוד X מתוך Y" ו־`totalItems` | חיפוש, סינון (סוג, סטטוס, חבילה), מיון (תאריך, תקציב, שם לקוח), מעבר בין עמודים, שינוי סטטוס, מחיקה, מעבר ליצירה או עריכה | 👑 |
| **אירוע חדש** `/admin/events/new` | יצירת אירוע | `GET /packages`, `POST /events` | טופס עם כל שדות `EventInput` | שמירה | 👑 |
| **עריכת אירוע** `/admin/events/:id/edit` | עריכה וניהול תמונות | `GET /events/:id`, `GET /packages`, `PUT /events/:id`, `POST /events/:id/photos`, `DELETE /events/:id/photos/:photoId` | טופס מלא עם הערכים הקיימים (כולל `notes`), תמונות האירוע | שמירה, העלאת תמונות, מחיקת תמונה | 👑 |
| **ניהול גלריה** `/admin/gallery` | ניהול כל העבודות | `GET /admin/gallery?...`, `POST /gallery`, `PATCH /gallery/:id`, `DELETE /gallery/:id` | רשת תמונות כולל מוסתרות (סימון "מוסתרת" לפי `isPublished`, "מובילה" לפי `isFeatured`), סינון לפי סוג/פרסום/מובילה, פקדי עמודים, טופס הוספה (`image`, `title`, `category` + רשות) | העלאה, עריכת כותרת וסוג, פרסום/הסתרה, סימון מובילה, שינוי סדר, מחיקה לצמיתות | 👑 |
| **אין הרשאה / לא נמצא** | הודעה כשהשרת מחזיר 403 או 404 | – | הודעה וקישור חזרה | – | – |

### 8.2 עדכון המסך אחרי שינוי

| פעולה | תשובת השרת | עדכון מומלץ במסך |
|---|---|---|
| יצירת אירוע | `201` + האירוע | מעבר ל־`/admin/events` וטעינה מחדש |
| עריכה (`PUT`) | `200` + האירוע המעודכן | החלפת האירוע לפי `id`, או טעינה מחדש |
| שינוי סטטוס | `200` + האירוע המעודכן | החלפת השורה בטבלה לפי `id` |
| מחיקת אירוע | `204` | הסרת השורה לפי `id` |
| העלאת תמונות | `201` + מערך התמונות החדשות | הוספה לסוף מערך `photos` |
| מחיקת תמונה | `204` | הסרה מ־`photos` לפי `id` |
| הוספה לגלריה | `201` + הפריט החדש | טעינה מחדש של `GET /admin/gallery` (המיקום תלוי ב־`sortOrder`) |
| עריכת פריט גלריה | `200` + הפריט המעודכן | החלפת הפריט לפי `id`. אם השתנו `sortOrder`, `category` או `isPublished` – טעינה מחדש של הרשימה |
| מחיקה מהגלריה | `204` | הסרה לפי `id` |
| אימות אימייל | `200` + Token ומשתמש חדשים | שמירת ה־Token וטעינה מחדש של `/events/my` |
| התחברות עם Google | `200` + Token, משתמש ו־`isNewUser` | שמירת ה־Token והמשתמש, כמו בהתחברות רגילה |
| עריכת פרופיל | `200` + `{ user }` המעודכן | החלפת המשתמש ב־State. ה־Token לא משתנה |

- **טבלה עם מסננים ועמודים:** אחרי שינוי בטבלה שיש בה חיפוש, סינון, מיון או עמודים, הכי בטוח לקרוא שוב ל־`GET /events` עם אותם פרמטרים, כולל `page`. אם מחקת את הפריט האחרון בעמוד, עברי לעמוד הקודם.
- **מניעת שליחה כפולה:** השביתי את כפתור "שמירה" בזמן שהבקשה נשלחת.

### 8.3 הגנה על נתיבים בצד הלקוח

| נתיב | תנאי להצגה |
|---|---|
| `/my-events`, `/my-events/:id`, `/profile` | יש `user` מחובר |
| `/admin/*` | `user.role === 'Admin'` |
| `/login`, `/register` | אין `user` מחובר (אחרת הפניה הלאה) |

ההגנה בצד הלקוח היא רק לנוחות. השרת בודק הרשאות בכל בקשה.

---

## 9. פונקציונליות שאינה קיימת בשרת

הרשימה הבאה מתארת פעולות ש**אין** להן Endpoint. אל תבני מסכים שמסתמכים עליהן. אם תרצי להוסיף משהו כזה, זו הרחבה של השרת, ולא חלק מהמפרט הנוכחי.

| פונקציה | המצב בשרת | מה לעשות בצד הלקוח |
|---|---|---|
| **התנתקות (Logout)** | אין Endpoint | מחיקת ה־Token מ־`localStorage`, ובמשתמש Google גם `googleLogout()` |
| **Refresh Token** | אין. ה־Token תקף שעתיים | אחרי 401: התחברות מחדש |
| **שכחתי סיסמה / איפוס סיסמה** | אין, ולא מתוכנן | משתמש שלא זוכר סיסמה יכול להתחבר עם Google, אם האימייל שלו ב־Gmail או Workspace |
| **שינוי סיסמה** | אין | – |
| **הוספת סיסמה למשתמש Google** | אין. משתמש שנרשם עם Google מתחבר רק עם Google | – |
| **שינוי אימייל** | אין. האימייל לקריאה בלבד | – |
| **ניתוק חשבון Google** | אין | – |
| **עמודים ב־`GET /packages`** | אין צורך. המחירון קטן, והתשובה נשארה מערך | – |
| **ניהול משתמשים** (רשימת לקוחות, שינוי תפקיד, מחיקה) | אין | – |
| **יצירת Admin נוסף** | אין. Admin נוצר רק ב־Seed | – |
| **מחיקה פיזית של חבילה** | אין. רק העברה לארכיון (`DELETE /packages/:id`) | – |
| **העלאת תמונה לחבילה** | אין. `imageUrl` הוא כתובת https | הזנת כתובת |
| **תשלום או הזמנה אוטומטית** | אין. המחירון להצגה בלבד | יצירת קשר עם הסטודיו |
| **מחיר שסוכם בהזמנה** | אין שדה כזה. `budget` הוא תקציב העיצוב, ומחיר החבילה לא נשמר בהזמנה | – |
| **הזמנה או בקשת שירות של לקוחה** | אין. **רק המנהלת יוצרת אירועים** | – |
| **טופס "צור קשר"** | אין | – |
| **שליחת מיילים** (קוד אימות, התראות) | אין. אין שירות מיילים חיצוני; קוד האימות מודפס ביומן השרת | לא להבטיח למשתמשת שתקבל מייל |
| **החלפת הקובץ של פריט גלריה** | אין. `PATCH` משנה רק פרטים | העלאת פריט חדש ומחיקת הישן |
| **העלאת תמונות על ידי לקוחה** | אין עדיין. רק המנהלת מעלה תמונות | – |
| **העלאת תמונת שער (`coverImageUrl`)** | אין Endpoint נפרד. זה שדה טקסט (URL) | הזנת כתובת, או העתקת `url` של תמונת אירוע שהועלתה |
| **חיפוש בשדות נוספים** | החיפוש הוא רק בשם האירוע ובשם הלקוח | – |

---

## 10. בדיקת התאמה לקוד ול־Swagger

### 10.1 מה נבדק

| בדיקה | תוצאה |
|---|---|
| כל הנתיבים ב־`src/routes/index.ts` מתועדים במדריך | ✅ 21 מתוך 21 |
| כל הנתיבים במדריך קיימים בשרת | ✅ אין Endpoints מומצאים |
| שדות הבקשה תואמים ל־Zod Schemas (`src/schemas/*`) | ✅ שמות, חובה או רשות, טווחים והודעות שגיאה |
| שדות התגובה תואמים ל־`src/utils/mappers.ts` | ✅ כולל `notes` רק למנהלת, `photoCount` רק ברשימות ו־`photos` רק באירוע בודד |
| הרשאות תואמות ל־Middleware (`authenticate`, `requireAdmin`) ולבדיקת הבעלות ב־Service | ✅ |
| מגבלות העלאה תואמות ל־`src/middleware/upload.ts` | ✅ |
| קודי השגיאה תואמים ל־`HttpError` ול־`errorHandler` | ✅ |
| התאמה ל־Swagger (`/api-docs`, `docs/openapi.json`) | ✅ אותן 21 פעולות, אותם נתיבים, Methods, הרשאות ומבני נתונים, כולל `Pagination`, `GoogleLoginRequest` ו־`UpdateProfileRequest` |
| מבנה הרשימות (`{ data, pagination }`) תואם ל־`src/utils/pagination.ts` | ✅ |
| כללי Google ותוצאות הקישור תואמים ל־`src/services/auth.service.ts` ול־`src/auth/googleToken.ts` | ✅ |

### 10.2 פרטים שמופיעים במדריך ולא בכל מקום ב־Swagger

הפרטים האלה נבדקו בקוד. הם לא סותרים את Swagger, אבל Swagger לא מפרט אותם בכל Endpoint:
- **`429`:** יכול להתקבל בכל נתיב `/api`, בגלל המגבלה הכללית של 300 בקשות בדקה. Swagger מציג אותו רק בנתיבי ההתחברות.
- **`413`:** מתקבל לגוף JSON גדול מ־100KB.
- **שגיאת CORS:** מתקבלת מכתובת שאינה ב־`CORS_ORIGIN`.
- **מסננים ריקים:** פרמטר ריק כמו `?status=` מחזיר `400`.
- **`PUT` בלי `notes` או `coverImageUrl`:** השדות נשמרים כ־`null`.

---

## 11. משתמשי הדגמה ונתוני Seed

נוצרים בפיתוח מקומי על ידי `npm run db:seed`. **בענן אין סיסמאות ידועות מראש.**

| תפקיד | אימייל | סיסמה | מה יש לו |
|---|---|---|---|
| Admin | `admin@eventstyle.example` | `Admin12345` | גישה לכל המערכת |
| Client | `noa.levi@example.com` | `Client12345` | 2 אירועים מקושרים |
| Client | `daniel.cohen@example.com` | `Client12345` | 2 אירועים מקושרים |

**נתונים נוספים:**
- 3 חבילות: Basic (1200), Premium (2800) ו־Luxury (5500).
- 10 פריטי גלריה.
- 6 אירועים. 2 מהם שייכים ללקוחות שאינם רשומים, כך שאפשר לבדוק את הקישור האוטומטי אחרי הרשמה ואימות. האימיילים שלהם הם `shira.avraham@example.com` ו־`yossi.mizrahi@example.com`.

**לבדיקת הרשמה** (`EMAIL_PROVIDER=console`): קוד האימות מודפס בטרמינל של השרת. אין שליחת מייל.

---

## 12. הגדרת התחברות עם Google

**בלי השלבים האלה:**
- כל שאר המערכת עובדת כרגיל.
- `POST /auth/google` מחזיר `503 GOOGLE_AUTH_NOT_CONFIGURED`.

### 12.1 מה צריך ליצור ב־Google Cloud Console

השמות בתפריטים של Google משתנים מדי פעם. אם משהו נראה אחרת, חפשי "OAuth consent screen" או "Credentials".

1. **פרויקט:**
   - היכנסי ל־https://console.cloud.google.com.
   - צרי פרויקט חדש (למשל `EventStyle`), או בחרי פרויקט קיים.
2. **מסך ההסכמה (OAuth consent screen / Google Auth Platform → Branding):**
   - **שם אפליקציה:** EventStyle.
   - **אימייל לתמיכה ואימייל ליצירת קשר:** האימייל שלך.
   - **סוג משתמשים (Audience):** **External**.
   - **מצב Testing:** כל עוד האפליקציה במצב הזה, רק משתמשים שתוסיפי תחת **Test users** יוכלו להתחבר. הוסיפי את כתובות ה־Gmail שאיתן תבדקי.
   - **הרשאות (Scopes):** אין צורך להוסיף. ההתחברות משתמשת רק ב־`openid`, `email` ו־`profile`, שמוגדרים כברירת מחדל.
3. **Client ID (APIs & Services → Credentials → Create credentials → OAuth client ID):**
   - **Application type:** **Web application**.
   - **Name:** למשל `EventStyle Web`.
   - **Authorized JavaScript origins:** הוסיפי את כתובות צד הלקוח:
     - `http://localhost:5173` (פיתוח מקומי ב־Vite)
     - `http://localhost` (Google דורש אותה גם כן בפיתוח מקומי עם הכפתור)
     - אחרי פריסה: הכתובת של צד הלקוח בענן, למשל `https://eventstyle.vercel.app`
   - **Authorized redirect URIs:** **לא צריך.** הכפתור עובד בחלון קופץ, בלי הפניה.
4. **העתקת הערך:** לחצי **Create**, והעתיקי את ה־**Client ID**. הוא נראה כך: `1234567890-abc...xyz.apps.googleusercontent.com`.
   - **Client secret:** Google מציג גם אותו. **אין בו צורך** בשיטה הזו, ואין לשים אותו בשום קובץ.

### 12.2 איפה מגדירים את ה־Client ID

| איפה | משתנה | ערך |
|---|---|---|
| Backend, מקומי: `backend/.env` | `GOOGLE_CLIENT_ID` | ה־Client ID מסעיף 12.1 |
| Backend, ענן: Render → Environment | `GOOGLE_CLIENT_ID` | אותו ערך |
| React, מקומי: `.env.development` | `VITE_GOOGLE_CLIENT_ID` | **אותו** Client ID בדיוק |
| React, ענן: `.env.production` או הגדרות האחסון | `VITE_GOOGLE_CLIENT_ID` | אותו ערך |

- **אותו ערך בשני המקומות:** השרת בודק שהטוקן נוצר בדיוק עבור ה־Client ID שלו (`aud`). אם הערכים שונים, תתקבל שגיאת `401 GOOGLE_AUTH_FAILED`.
- **הפעלה מחדש:** אחרי שינוי ב־`.env` הפעילי מחדש את השרת (`npm run dev`) ואת Vite.
- **האם זה סוד?** ה־Client ID **אינו סוד**, כי הוא מופיע בדפדפן. ובכל זאת שומרים אותו במשתני סביבה ולא בקוד.

### 12.3 בדיקה מהירה

1. ודאי ש־`GOOGLE_CLIENT_ID` מוגדר ב־`backend/.env`, והפעילי את השרת.
2. ב־React, לחצי על כפתור Google והתחברי עם כתובת שהוספת כ־Test user.
3. **התוצאה הצפויה:** `200` עם `isNewUser: true` בפעם הראשונה, ו־`false` בפעם השנייה.
4. **אם משהו לא עובד:**

| תסמין | סיבה אפשרית |
|---|---|
| 503 | `GOOGLE_CLIENT_ID` לא מוגדר בשרת, או שהשרת לא הופעל מחדש |
| 401 `GOOGLE_AUTH_FAILED` | Client ID שונה בין React לשרת |
| הכפתור לא נטען, או שגיאת `origin` בחלון של Google | הכתובת של Vite לא נמצאת ב־Authorized JavaScript origins. שינוי שם יכול לקחת כמה דקות להתעדכן |
| Google חוסם את ההתחברות ("access blocked") | המשתמש לא נמצא ברשימת Test users |

### 12.4 משתני סביבה חדשים: סיכום

| משתנה | איפה | חובה | הערות |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Backend | ✘ (בלעדיו Google מושבת) | Client ID מסוג Web application. מופיע ב־`.env.example` וב־`render.yaml` בלי ערך |
| `VITE_GOOGLE_CLIENT_ID` | React | ✘ (רק אם מציגים כפתור Google) | אותו ערך כמו בשרת |

אין משתני סביבה חדשים לעריכת פרופיל או לחלוקה לעמודים.
