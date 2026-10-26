import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { HttpError } from '../errors/HttpError';

/** המנפיקים החוקיים של Google ID Token (לפי התיעוד של Google) */
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** דומיינים שבהם Google היא ספקית האימייל עצמה – כלומר הבעלות על הכתובת מאומתת בוודאות */
const GOOGLE_MAIL_DOMAINS = ['gmail.com', 'googlemail.com'];

export interface GoogleIdentity {
  /** המזהה היציב של חשבון Google (sub) – משמש לזיהוי, לא האימייל */
  googleId: string;
  email: string;
  name: string | null;
  /**
   * true רק כשאפשר לסמוך על כך שבעל חשבון Google הוא גם בעל כתובת האימייל:
   * הכתובת מאומתת ב-Google, וגם Google היא ספקית הדואר שלה (Gmail או דומיין Google Workspace – hd).
   */
  emailTrusted: boolean;
}

const client = new OAuth2Client();

const invalidToken = () => new HttpError(401, 'GOOGLE_AUTH_FAILED', 'Invalid or expired Google token');

/**
 * אימות מלא של Google ID Token בצד השרת:
 * חתימה (מול המפתחות הציבוריים של Google), issuer, audience (ה-Client ID שלנו) ותוקף (exp / iat).
 * הטוקן עצמו לא נשמר ולא נכתב ליומן.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new HttpError(503, 'GOOGLE_AUTH_NOT_CONFIGURED', 'Google sign-in is not configured on the server');
  }

  let certs;
  try {
    certs = (await client.getFederatedSignonCertsAsync()).certs;
  } catch {
    throw new HttpError(502, 'GOOGLE_UNAVAILABLE', 'Could not reach Google to verify the sign-in. Please try again');
  }

  let payload;
  try {
    // הודעות השגיאה של הספרייה כוללות את הטוקן – לכן לא מעבירים אותן הלאה
    const ticket = await client.verifySignedJwtWithCertsAsync(idToken, certs, clientId, GOOGLE_ISSUERS);
    payload = ticket.getPayload();
  } catch {
    throw invalidToken();
  }

  if (!payload?.sub || !payload.email) throw invalidToken();
  if (payload.email_verified !== true) {
    throw new HttpError(401, 'GOOGLE_AUTH_FAILED', 'The email address of this Google account is not verified');
  }

  const email = payload.email.trim().toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const emailTrusted = GOOGLE_MAIL_DOMAINS.includes(domain) || (Boolean(payload.hd) && payload.hd?.toLowerCase() === domain);

  return {
    googleId: payload.sub,
    email,
    name: payload.name?.trim() || null,
    emailTrusted,
  };
}
