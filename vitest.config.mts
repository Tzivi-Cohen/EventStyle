import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { isSameDatabase } from './tests/databaseGuard';

/**
 * הבדיקות רצות מול PostgreSQL אמיתי – מסד נתונים נפרד לבדיקות (TEST_DATABASE_URL).
 * אזהרה: הבדיקות מוחקות את כל הנתונים במסד הבדיקות!
 */
const fileEnv = existsSync('.env.test') ? parse(readFileSync('.env.test')) : {};
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy .env.test.example to .env.test and point it to a SEPARATE test database.',
  );
}
// הבדיקות מוחקות את כל הנתונים – עוצרים לפני כל פעולה אם מסד הבדיקות הוא מסד הפיתוח
const devEnv = existsSync('.env') ? parse(readFileSync('.env')) : {};
const developmentUrls = [process.env.DATABASE_URL, devEnv.DATABASE_URL].filter((url): url is string => Boolean(url));
if (developmentUrls.some((url) => isSameDatabase(url, testDatabaseUrl))) {
  throw new Error('TEST_DATABASE_URL points to the same database as DATABASE_URL. Tests were stopped before touching any data.');
}

// זמין גם ל-globalSetup (שרץ בתהליך הראשי)
process.env.EVENTSTYLE_TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: 'test-secret-for-automated-tests-only-0123456789',
      JWT_EXPIRES_IN: '1h',
      CORS_ORIGIN: 'http://localhost:5173',
      EMAIL_PROVIDER: 'console',
      CLOUDINARY_CLOUD_NAME: '',
      CLOUDINARY_API_KEY: '',
      CLOUDINARY_API_SECRET: '',
      // Client ID מדומה לבדיקות – החתימה נבדקת מול מפתח שנוצר בבדיקה עצמה
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    },
  },
});
