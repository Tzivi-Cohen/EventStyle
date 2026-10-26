import type { Prisma, User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../errors/HttpError';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';
import {
  VERIFICATION,
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeMatches,
} from '../auth/verificationCode';
import { verifyGoogleIdToken, type GoogleIdentity } from '../auth/googleToken';
import { getMailer } from './email/mailer';
import { toPublicUser } from '../utils/mappers';
import type { LoginInput, RegisterInput, UpdateProfileInput, VerifyEmailInput } from '../schemas/auth.schema';

const MINUTE = 60 * 1000;

function authResponse(user: User) {
  return { token: signAccessToken(user), user: toPublicUser(user) };
}

/**
 * חשבון שאפשר להחליף כשבעל הכתובת האמיתי מוכיח בעלות: לקוח שעדיין לא אימת את האימייל
 * ואין לו חשבון Google. חשבון מאומת או חשבון מנהלת לעולם לא מוחלף.
 */
function isReplaceableUnverified(user: Pick<User, 'emailVerified' | 'role' | 'googleId'>): boolean {
  return !user.emailVerified && user.role === 'Client' && user.googleId === null;
}

/**
 * מחיקת חשבון לא מאומת כחלק מהחלפת בעלות (בתוך Transaction).
 * מוחקים ולא מעדכנים כדי שהחשבון החדש יקבל id חדש – כך כל JWT שהונפק לחשבון הישן
 * נדחה (401 "User no longer exists").
 * המחיקה מותנית: אם בינתיים החשבון אומת, קושר ל-Google, או שיש לו אירועים
 * (מצב שלא אמור לקרות לחשבון לא מאומת) – לא נמחק דבר, והבקשה נכשלת עם 409.
 */
async function deleteReplaceableAccount(tx: Prisma.TransactionClient, userId: number) {
  const { count } = await tx.user.deleteMany({
    where: { id: userId, emailVerified: false, role: 'Client', googleId: null, events: { none: {} } },
  });
  if (count !== 1) {
    throw HttpError.conflict('The account was changed by another request. Please try again');
  }
}

/** קישור אירועים שממתינים לכתובת האימייל – רק למשתמש שהבעלות שלו על הכתובת מאומתת */
function linkPendingEvents(tx: Prisma.TransactionClient, user: Pick<User, 'id' | 'email'>) {
  return tx.event.updateMany({
    where: { clientEmail: user.email, userId: null },
    data: { userId: user.id },
  });
}

/**
 * בדיקת מגבלות שליחה (Cooldown של 60 שניות + עד 5 שליחות בשעה)
 * והחזרת השדות שיש לשמור עבור קוד חדש.
 */
function prepareNewCode(email: string, user: Pick<User, 'verificationLastSentAt' | 'verificationSendCount' | 'verificationWindowStart'> | null) {
  const now = new Date();

  if (user?.verificationLastSentAt) {
    const secondsSinceLast = (now.getTime() - user.verificationLastSentAt.getTime()) / 1000;
    if (secondsSinceLast < VERIFICATION.RESEND_COOLDOWN_SECONDS) {
      const retryAfterSeconds = Math.ceil(VERIFICATION.RESEND_COOLDOWN_SECONDS - secondsSinceLast);
      throw HttpError.tooManyRequests(`Please wait ${retryAfterSeconds} seconds before requesting a new code`, {
        retryAfterSeconds,
      });
    }
  }

  const windowStart = user?.verificationWindowStart;
  const windowExpired =
    !windowStart || now.getTime() - windowStart.getTime() > VERIFICATION.SEND_WINDOW_MINUTES * MINUTE;
  const sendCount = windowExpired ? 0 : (user?.verificationSendCount ?? 0);

  if (sendCount >= VERIFICATION.MAX_SENDS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil(
      (windowStart!.getTime() + VERIFICATION.SEND_WINDOW_MINUTES * MINUTE - now.getTime()) / 1000,
    );
    throw HttpError.tooManyRequests('Too many verification codes were requested. Please try again later', {
      retryAfterSeconds,
    });
  }

  const code = generateVerificationCode();
  return {
    code,
    data: {
      verificationCodeHash: hashVerificationCode(email, code),
      verificationCodeExpiresAt: new Date(now.getTime() + VERIFICATION.CODE_TTL_MINUTES * MINUTE),
      verificationAttempts: 0,
      verificationLastSentAt: now,
      verificationSendCount: sendCount + 1,
      verificationWindowStart: windowExpired ? now : windowStart,
    },
  };
}

/**
 * הרשמה: תמיד בתפקיד Client, עם emailVerified=false.
 * נשלח קוד אימות למייל. אירועים קיימים מקושרים רק אחרי אימות מוצלח.
 * אם קיים חשבון שעדיין לא אומת עם אותו אימייל – הוא מוחלף בחשבון חדש (id חדש) ונשלח קוד חדש.
 * כך אי אפשר "לתפוס" כתובת של מישהו אחר בלי לאמת אותה, וה-JWT שהונפק לחשבון הישן נדחה.
 * מגבלות שליחת הקודים (Cooldown ומכסה לשעה) עוברות לחשבון החדש.
 */
export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  // חשבון מאומת, חשבון מנהלת וחשבון שמקושר ל-Google לא מוחלפים בהרשמה עם סיסמה
  if (existing && !isReplaceableUnverified(existing)) {
    throw HttpError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const { code, data: codeData } = prepareNewCode(input.email, existing);
  const newUserData = {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash,
    role: 'Client' as const,
    emailVerified: false,
    ...codeData,
  };

  const user = existing
    ? await prisma.$transaction(async (tx) => {
        await deleteReplaceableAccount(tx, existing.id);
        return tx.user.create({ data: newUserData });
      })
    : await prisma.user.create({ data: newUserData });

  let verificationEmailSent = true;
  try {
    await getMailer().sendVerificationCode({ email: user.email, name: user.fullName }, code);
  } catch (error) {
    console.error('Failed to send verification email on register:', (error as Error).message);
    verificationEmailSent = false;
  }

  return {
    message: verificationEmailSent
      ? `Registration successful. A 6-digit verification code was sent to ${user.email}`
      : 'Registration successful, but the verification email could not be sent. Use resend-code to try again',
    verificationEmailSent,
    ...authResponse(user),
  };
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
 * אימייל, תפקיד, Google ושדות אימות לא ניתנים לשינוי כאן.
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
 *    - חשבון לא מאומת → ייתכן שמישהו "תפס" את הכתובת עם סיסמה משלו. בעל הכתובת המוכח גובר:
 *      החשבון הישן נמחק ונוצר חשבון Google חדש (id חדש, בלי הסיסמה והטלפון של החשבון הישן),
 *      כך שגם ה-JWT של החשבון הישן נדחה.
 *    אחרת → 409, בלי לשנות דבר בחשבון הקיים.
 * 3. אין משתמש כלל → משתמש חדש בתפקיד Client בלבד.
 */
export async function loginWithGoogle(idToken: string) {
  const google = await verifyGoogleIdToken(idToken);

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: google.googleId } });
  if (byGoogleId) {
    return { ...authResponse(byGoogleId), isNewUser: false };
  }

  const byEmail = await prisma.user.findUnique({ where: { email: google.email } });
  if (byEmail) {
    if (byEmail.role === 'Admin') {
      throw HttpError.conflict('This account must sign in with email and password');
    }
    if (byEmail.googleId) {
      throw HttpError.conflict('This email is already linked to a different Google account');
    }
    if (!google.emailTrusted) {
      throw HttpError.conflict(
        'An account with this email already exists. Sign in with your email and password',
      );
    }

    if (isReplaceableUnverified(byEmail)) {
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
 * משתמש Google חדש בתפקיד Client. האימייל נחשב מאומת רק כש-Google היא ספקית הדואר שלו;
 * אחרת המשתמש יאמת אותו בקוד במייל (resend-code + verify-email), כמו בהרשמה רגילה.
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

const invalidCode = () =>
  new HttpError(400, 'INVALID_CODE', 'Invalid verification code. Check the code or request a new one');

/**
 * אימות האימייל בקוד בן 6 ספרות:
 * - תקף 10 דקות.
 * - חד-פעמי (נמחק מיד לאחר שימוש מוצלח).
 * - עד 5 ניסיונות שגויים – ואז הקוד נפסל.
 * רק לאחר הצלחה מקושרים למשתמש האירועים הקיימים עם אותו אימייל.
 */
export async function verifyEmail(input: VerifyEmailInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw invalidCode();
  if (user.emailVerified) throw HttpError.conflict('Email is already verified');
  if (!user.verificationCodeHash || !user.verificationCodeExpiresAt) throw invalidCode();

  if (user.verificationCodeExpiresAt.getTime() < Date.now()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationCodeHash: null, verificationCodeExpiresAt: null },
    });
    throw new HttpError(400, 'CODE_EXPIRED', 'Verification code has expired. Please request a new one');
  }

  if (!verificationCodeMatches(user.email, input.code, user.verificationCodeHash)) {
    // הגדלה אטומית של מונה הניסיונות (בטוח גם בבקשות מקבילות)
    const { verificationAttempts: attempts } = await prisma.user.update({
      where: { id: user.id },
      data: { verificationAttempts: { increment: 1 } },
      select: { verificationAttempts: true },
    });
    if (attempts >= VERIFICATION.MAX_WRONG_ATTEMPTS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { verificationCodeHash: null, verificationCodeExpiresAt: null },
      });
      throw new HttpError(400, 'INVALID_CODE', 'Too many wrong attempts. The code was cancelled, please request a new one');
    }
    throw new HttpError(400, 'INVALID_CODE', 'Invalid verification code', {
      attemptsLeft: VERIFICATION.MAX_WRONG_ATTEMPTS - attempts,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    // עדכון מותנה ב-Hash הנוכחי – מבטיח שקוד ישמש פעם אחת בלבד גם בבקשות מקבילות
    const consumed = await tx.user.updateMany({
      where: { id: user.id, verificationCodeHash: user.verificationCodeHash, emailVerified: false },
      data: {
        emailVerified: true,
        verificationCodeHash: null,
        verificationCodeExpiresAt: null,
        verificationAttempts: 0,
      },
    });
    if (consumed.count !== 1) throw invalidCode();

    const linked = await linkPendingEvents(tx, user);
    const verifiedUser = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    return { linkedEventsCount: linked.count, verifiedUser };
  });

  return {
    message: 'Email verified successfully',
    linkedEventsCount: result.linkedEventsCount,
    ...authResponse(result.verifiedUser),
  };
}

const RESEND_GENERIC_MESSAGE =
  'If an unverified account exists for this email, a new verification code has been sent';

/**
 * שליחה חוזרת של קוד. התשובה זהה גם אם החשבון לא קיים / כבר מאומת,
 * כדי לא לחשוף אילו כתובות רשומות במערכת.
 */
export async function resendVerificationCode(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerified) {
    return { message: RESEND_GENERIC_MESSAGE };
  }

  const { code, data } = prepareNewCode(email, user);
  await prisma.user.update({ where: { id: user.id }, data });
  await getMailer().sendVerificationCode({ email: user.email, name: user.fullName }, code);

  return { message: RESEND_GENERIC_MESSAGE };
}
