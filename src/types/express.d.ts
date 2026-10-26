import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    /** המשתמש המחובר – נקבע רק על ידי ה-Middleware של האימות, מתוך ה-Token */
    interface AuthUser {
      id: number;
      email: string;
      role: Role;
      emailVerified: boolean;
    }

    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
