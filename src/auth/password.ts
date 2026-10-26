import bcrypt from 'bcryptjs';

// 12 סבבים ב-Production; בבדיקות אוטומטיות בלבד – פחות, כדי שירוצו מהר
const SALT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Hash קבוע להשוואה כשהמשתמש לא קיים – כדי שזמן התגובה בהתחברות
 * יהיה זהה בין "משתמש לא קיים" ל"סיסמה שגויה".
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', SALT_ROUNDS);
