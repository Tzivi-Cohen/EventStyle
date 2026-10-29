const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

function parseTarget(connectionString: string): DatabaseTarget | null {
  try {
    const url = new URL(connectionString.trim());
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return null;
    const host = (url.searchParams.get('host') ?? url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || decodeURIComponent(url.username);
    return { host, port: url.port || '5432', database: database.toLowerCase() };
  } catch {
    return null;
  }
}

/** שרת מקומי: localhost / 127.x.x.x / ::1, או Unix socket (בלי host, או host שהוא נתיב) */
function isLocalHost(host: string): boolean {
  return host === '' || host.startsWith('/') || LOCAL_HOSTS.has(host) || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * לאיזה מסד כתובת PostgreSQL מצביעה בפועל: שרת, פורט ושם מסד.
 * משתמש, סיסמה ופרמטרים לא משנים את המסד, ולכן לא נכללים. localhost / 127.0.0.1 / ::1 נחשבים לאותו שרת.
 */
function databaseIdentity(connectionString: string): string {
  const target = parseTarget(connectionString);
  if (!target) return connectionString.trim();
  return `${isLocalHost(target.host) ? 'localhost' : target.host}:${target.port}/${target.database}`;
}

export function isSameDatabase(a: string, b: string): boolean {
  return databaseIdentity(a) === databaseIdentity(b);
}

/** הבדיקות מוחקות את כל הנתונים – מותר רק מסד PostgreSQL מקומי ששמו מסמן אותו כמסד בדיקות */
export function isLocalTestDatabase(connectionString: string): boolean {
  const target = parseTarget(connectionString);
  return target !== null && isLocalHost(target.host) && target.database.includes('test');
}

/** נזרק לפני כל חיבור למסד. ההודעות לא כוללות ערכי חיבור */
export function assertSafeTestDatabase(testDatabaseUrl: string, developmentUrls: (string | undefined)[]): void {
  if (!isLocalTestDatabase(testDatabaseUrl)) {
    throw new Error(
      'TEST_DATABASE_URL must point to a local PostgreSQL test database (localhost, database name containing "test"). ' +
        'Remote databases (Neon, Render, any cloud host) are never allowed. Tests were stopped before touching any data.',
    );
  }
  if (developmentUrls.some((url) => url && isSameDatabase(url, testDatabaseUrl))) {
    throw new Error('TEST_DATABASE_URL points to the same database as DATABASE_URL. Tests were stopped before touching any data.');
  }
}
