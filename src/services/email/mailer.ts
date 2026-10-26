import { env } from '../../config/env';

/** ממשק כללי לשליחת מיילים – מאפשר להחליף ספק (או להשתמש בדמה בבדיקות) */
export interface Mailer {
  sendVerificationCode(to: { email: string; name: string }, code: string): Promise<void>;
}

/** אין שירות מיילים חיצוני: הקוד מודפס ביומן השרת במקום להישלח */
export class ConsoleMailer implements Mailer {
  async sendVerificationCode(to: { email: string; name: string }, code: string): Promise<void> {
    console.log(`📧 [EMAIL_PROVIDER=console] Verification code for ${to.email}: ${code}`);
  }
}

function createDefaultMailer(): Mailer {
  if (env.isProduction) {
    console.warn(
      '⚠️  EMAIL_PROVIDER=console in production: verification codes are printed to the server log only.',
    );
  }
  return new ConsoleMailer();
}

let currentMailer: Mailer | undefined;

export function getMailer(): Mailer {
  currentMailer ??= createDefaultMailer();
  return currentMailer;
}

/** מאפשר להחליף את שירות המיילים (בשימוש בבדיקות) */
export function setMailer(mailer: Mailer): void {
  currentMailer = mailer;
}
