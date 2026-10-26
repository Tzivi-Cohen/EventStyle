import { execSync } from 'node:child_process';

/** מריץ את ה-Migrations על מסד הבדיקות לפני כל הבדיקות */
export default function setup() {
  const databaseUrl = process.env.EVENTSTYLE_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL for tests is missing');
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
