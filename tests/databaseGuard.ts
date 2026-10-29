const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * לאיזה מסד כתובת PostgreSQL מצביעה בפועל: שרת, פורט ושם מסד.
 * משתמש, סיסמה ופרמטרים לא משנים את המסד, ולכן לא נכללים. localhost / 127.0.0.1 / ::1 נחשבים לאותו שרת.
 */
function databaseIdentity(connectionString: string): string {
  try {
    const url = new URL(connectionString.trim());
    const host = (url.searchParams.get('host') ?? url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
    const port = url.port || '5432';
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || decodeURIComponent(url.username);
    return `${LOCAL_HOSTS.has(host) ? 'localhost' : host}:${port}/${database.toLowerCase()}`;
  } catch {
    return connectionString.trim();
  }
}

export function isSameDatabase(a: string, b: string): boolean {
  return databaseIdentity(a) === databaseIdentity(b);
}
