import { Prisma, type User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';
import { verifyGoogleIdToken, type GoogleIdentity } from '../auth/googleToken';
import { toPublicUser } from '../utils/mappers';
import type { LoginInput, RegisterInput, UpdateProfileInput } from '../schemas/auth.schema';

/*
 * אין אימות אימייל בקוד. emailVerified=true רק כשהבעלות על הכתובת הוכחה:
 * התחברות Google עם ספקית דואר של Google (Gmail / Workspace), או חשבון שאומת בעבר.
 * חשבון סיסמה חדש נשאר emailVerified=false – הוא עובד כרגיל (התחברות, בקשות),
 * אבל אירועים שהמנהלת פתחה לפי כתובת האימייל לא מקושרים אליו אוטומטית.
 */

function authResponse(user: User) {
  return { token: signAccessToken(user), user: toPublicUser(user) };
}

/**
 * חשבון שבעל הכתובת המוכח (Google) יכול לקבל במקומו: לקוח שהבעלות שלו על הכתובת לא הוכחה
 * ואין לו חשבון Google. חשבון מאומת או חשבון מנהלת לעולם לא מוחלף.
 */
function isReplaceableUnverified(user: Pick<User, 'emailVerified' | 'role' | 'googleId'>): boolean {
  return !user.emailVerified && user.role === 'Client' && user.googleId === null;
}

/**
 * מחיקת חשבון לא מאומת כחלק מהחלפת בעלות (בתוך Transaction).
 * מוחקים ולא מעדכנים כדי שהחשבון החדש יקבל id חדש – כך כל JWT שהונפק לחשבון הישן
 * נדחה (401 "User no longer exists").
 * המחיקה מותנית: אם בינתיים החשבון אומת, קושר ל-Google, או שיש לו אירועים או בקשות –
 * לא נמחק דבר, והבקשה נכשלת עם 409.
 */
async function deleteReplaceableAccount(tx: Prisma.TransactionClient, userId: number) {
  const { count } = await tx.user.deleteMany({
    where: { id: userId, emailVerified: false, role: 'Client', googleId: null, events: { none: {} } },
  });
  if (count !== 1) {
    throw HttpError.conflict('The account was changed by another request. Please try again');
  }
}

/** קישור אירועים שממתינים לכתובת האימייל – רק למשתמש שהבעלות שלו על הכתובת הוכחה */
function linkPendingEvents(tx: Prisma.TransactionClient, user: Pick<User, 'id' | 'email'>) {
  return tx.event.updateMany({
    where: { clientEmail: user.email, userId: null },
    data: { userId: user.id },
  });
}

const emailTaken = () => HttpError.conflict('An account with this email already exists');

/**
 * הרשמה עם אימייל וסיסמה: תמיד בתפקיד Client, עם emailVerified=false, ומחזירה Token מיד.
 * כתובת שכבר רשומה (בכל מצב) → 409. חשבון קיים אף פעם לא מוחלף בהרשמה –
 * בלי קוד אימות, החלפה הייתה מאפשרת לכל אחד למחוק חשבון של מישהו אחר.
 */
export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw emailTaken();

  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        role: 'Client',
        emailVerified: false,
      },
    });
  } catch (error) {
    // שתי הרשמות במקביל: ה-UNIQUE על email מאפשר רק לאחת להישמר.
    // המפסידה מקבלת את אותה הודעה כמו בהרשמה חוזרת רגילה (ולא הודעת P2002 כללית)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw emailTaken();
    }
    throw error;
  }

  return { message: 'Registration successful', ...authResponse(user) };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // משווים גם כשהמשתמש לא קיים, כדי שזמן התגובה לא יחשוף אילו כתובות רשומות
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  // משתמש שנרשם דרך Google בלבד (בלי סיסמה מקומית) לא יכול להתחבר עם סיסמה
  if (!user || !user.passwordHash || !valid) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return authResponse(user);
}

export async function getCurrentUser(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw HttpError.unauthorized('User no longer exists');
  return { user: toPublicUser(user) };
}

/**
 * עריכת פרופיל: רק שם, טלפון וכתובת, ורק של המשתמש המחובר (המזהה מגיע מה-Token, לא מהבקשה).
 * שדה שלא נשלח לא משתנה. address=null מוחק את הכתובת.
 * אימייל, תפקיד, Google ומצב האימות לא ניתנים לשינוי כאן.
 */
export async function updateProfile(userId: number, input: UpdateProfileInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.fullName !== undefined && { fullName: input.fullName }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.address !== undefined && { address: input.address }),
    },
  });
  return { user: toPublicUser(user) };
}

const signInWithPassword = () =>
  HttpError.conflict('An account with this email already exists. Sign in with your email and password');

/**
 * התחברות / הרשמה עם Google.
 * הזיהוי לפי המזהה היציב של Google (sub), לא לפי האימייל.
 *
 * 1. יש משתמש עם אותו googleId → התחברות.
 * 2. אין, אבל יש משתמש עם אותו אימייל → פעולה רק אם זה בטוח:
 *    - החשבון אינו Admin (מנהלת מתחברת רק עם סיסמה), ואינו מקושר לחשבון Google אחר.
 *    - Google היא ספקית האימייל (Gmail / Workspace), כך שהבעלות על הכתובת ודאית.
 *    ואז:
 *    - חשבון מאומת → מקשרים אליו את Google (אותו id, הסיסמה ממשיכה לעבוד).
 *    - חשבון לא מאומת בלי אירועים ובקשות → ייתכן שמישהו "תפס" את הכתובת עם סיסמה משלו.
 *      בעל הכתובת המוכח גובר: החשבון הישן נמחק ונוצר חשבון Google חדש (id חדש, בלי הסיסמה
 *      והטלפון של החשבון הישן), כך שגם ה-JWT של החשבון הישן נדחה.
 *    - חשבון לא מאומת עם אירועים או בקשות → 409 (התחברות עם סיסמה). לא מקשרים Google לחשבון
 *      שהסיסמה שלו אולי של מישהו אחר, ולא מוחקים בקשות.
 *    אחרת → 409, בלי לשנות דבר בחשבון הקיים.
 * 3. אין משתמש כלל → משתמש חדש בתפקיד Client בלבד.
 */
export async function loginWithGoogle(idToken: string) {
  const google = await verifyGoogleIdToken(idToken);

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: google.googleId } });
  if (byGoogleId) {
    return { ...authResponse(byGoogleId), isNewUser: false };
  }

  const byEmail = await prisma.user.findUnique({
    where: { email: google.email },
    include: { _count: { select: { events: true } } },
  });
  if (byEmail) {
    if (byEmail.role === 'Admin') {
      throw HttpError.conflict('This account must sign in with email and password');
    }
    if (byEmail.googleId) {
      throw HttpError.conflict('This email is already linked to a different Google account');
    }
    if (!google.emailTrusted) throw signInWithPassword();

    if (isReplaceableUnverified(byEmail)) {
      if (byEmail._count.events > 0) throw signInWithPassword();
      const user = await prisma.$transaction(async (tx) => {
        await deleteReplaceableAccount(tx, byEmail.id);
        return createGoogleUser(tx, google);
      });
      return { ...authResponse(user), isNewUser: true };
    }

    // קישור מותנה: רק אם החשבון עדיין מאומת ועדיין לא מקושר (בטוח גם בבקשות מקבילות)
    const { count } = await prisma.user.updateMany({
      where: { id: byEmail.id, role: 'Client', emailVerified: true, googleId: null },
      data: { googleId: google.googleId },
    });
    if (count !== 1) {
      throw HttpError.conflict('The account was changed by another request. Please try again');
    }
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: byEmail.id } });
    return { ...authResponse(linked), isNewUser: false };
  }

  const user = await prisma.$transaction((tx) => createGoogleUser(tx, google));
  return { ...authResponse(user), isNewUser: true };
}

/**
 * משתמש Google חדש בתפקיד Client. האימייל נחשב מאומת רק כש-Google היא ספקית הדואר שלו –
 * ורק אז מקושרים אליו אירועים שהמנהלת פתחה לפי הכתובת.
 */
async function createGoogleUser(tx: Prisma.TransactionClient, google: GoogleIdentity) {
  const created = await tx.user.create({
    data: {
      fullName: (google.name ?? google.email.split('@')[0]!).slice(0, 100),
      email: google.email,
      googleId: google.googleId,
      role: 'Client',
      emailVerified: google.emailTrusted,
    },
  });
  if (google.emailTrusted) {
    await linkPendingEvents(tx, created);
  }
  return created;
}
