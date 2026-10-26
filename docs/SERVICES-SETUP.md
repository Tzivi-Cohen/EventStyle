# הגדרת שירותים חיצוניים (חינמיים)

> **חשוב:** את המפתחות והסיסמאות מכניסים רק לקובץ `.env` במחשב שלך, או להגדרות Environment ב־Render.
> אין לשלוח אותם בצ'אט, במייל או ב־GitHub.
>
> למסלולים החינמיים יש **מגבלות**, והן עשויות להשתנות. בדקי את התנאים העדכניים באתר של כל שירות לפני ההרשמה.

## 1. PostgreSQL בענן – Neon

1. היכנסי ל־<https://neon.tech> ופתחי חשבון. במסלול החינמי לא נדרש כרטיס אשראי.
2. צרי Project חדש, למשל בשם `eventstyle`, ובחרי Region באירופה.
3. העתיקי את ה־**Connection string**. היא נראית כך:
   `postgresql://USER:PASSWORD@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. זה הערך של `DATABASE_URL`.

חלופות: Supabase (Database → Connection string → URI), או PostgreSQL של Render. שימי לב שבמסלול החינמי של Render מסד הנתונים מוגבל בזמן.

## 2. קוד אימות האימייל – בלי שירות מיילים

הפרויקט **לא משתמש בשירות מיילים חיצוני** (Brevo הוסר). אין צורך לפתוח חשבון או להגדיר מפתח.

קוד האימות בן 6 הספרות מודפס ביומן השרת: בטרמינל בפיתוח מקומי, וב־**Logs** של Render בענן:
```
📧 [EMAIL_PROVIDER=console] Verification code for noa@test.com: 482913
```

במשתני הסביבה מספיק:
```
EMAIL_PROVIDER=console
```

> משתמשים שמתחברים עם Google (Gmail או Workspace) לא צריכים קוד, כי האימייל שלהם מאומת אוטומטית.
> אם נשארו אצלך ב־`.env` או ב־Render המשתנים `BREVO_API_KEY`, `EMAIL_FROM` או `EMAIL_FROM_NAME`, השרת מתעלם מהם. אפשר למחוק אותם, ומומלץ לבטל את מפתח ה־API בחשבון Brevo.

## 3. אחסון תמונות – Cloudinary

אין לשמור תמונות בדיסק של Render, כי הן נמחקות בכל פריסה ובכל הפעלה מחדש. לכן התמונות נשמרות ב־Cloudinary.

1. היכנסי ל־<https://cloudinary.com> ופתחי חשבון חינמי. נכון לכתיבת המסמך לא נדרש כרטיס אשראי, ויש מכסת אחסון ותעבורה.
2. בדף **Dashboard** (או Settings → API Keys) תמצאי:
   - Cloud name
   - API Key
   - API Secret
3. הגדירי:
   ```
   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   ```

אם המשתנים האלה ריקים, השרת עובד כרגיל, אבל העלאת תמונות מחזירה `503 STORAGE_NOT_CONFIGURED`. תמונות ה־Seed משתמשות בכתובות חיצוניות לדוגמה (picsum.photos), ולא צריכות Cloudinary.

**עיבוד תמונות לפני העלאה:** השרת מעבד מחדש כל תמונה (ספריית `sharp`) לפני שהיא נשלחת ל־Cloudinary: סיבוב לפי כיוון ה־EXIF, הקטנה עד 2500 פיקסלים והסרת כל המטא־דאטה (כולל מיקום GPS). בנוסף, ההעלאה ל־Cloudinary כוללת `allowed_formats` (jpg, png, webp) ו־incoming transformation עם הדגל `force_strip`, לפי תיעוד Upload API של Cloudinary. אין צורך בהגדרה נוספת בחשבון.

> ⚠️ **לפני שמאפשרים ללקוחות להעלות תמונות פרטיות:** קישורי Cloudinary רגילים (`upload`) פתוחים לכל מי שמחזיק בקישור. "הסתרה" או בדיקת הרשאות ב־API לא מספיקות לתמונות פרטיות. יש להוסיף הגנת גישה גם ברמת האחסון והקישור – למשל העלאה עם `type: 'authenticated'` והחזרת קישורים חתומים בעלי תוקף – לפני שהיכולת נפתחת.

## 4. סוד JWT

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
העתיקי את הפלט ל־`JWT_SECRET`. ב־Render זה לא נדרש: הקובץ `render.yaml` מבקש מ־Render ליצור סוד אקראי אוטומטית.

## 5. התחברות עם Google (רשות)

- **מה צריך:** משתנה אחד בשרת, `GOOGLE_CLIENT_ID`, מסוג **Web application** מ־Google Cloud Console.
- **בלעדיו:** כל המערכת עובדת, ורק `POST /api/auth/google` מחזיר `503`.
- **בצד הלקוח:** אותו ערך בדיוק נכנס ל־`VITE_GOOGLE_CLIENT_ID`.
- **Client secret:** לא נדרש, ואין לשמור אותו באף קובץ.

הוראות מלאות, צעד אחר צעד, נמצאות ב־[FRONTEND-API-GUIDE.md, פרק 12](../FRONTEND-API-GUIDE.md#12-הגדרת-התחברות-עם-google):
- יצירת מסך ההסכמה ו־Test users.
- יצירת Client ID והגדרת Authorized JavaScript origins.
- איפה מגדירים את הערך בשרת, ב־React וב־Render.
