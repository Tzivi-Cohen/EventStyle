import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/** מופע יחיד של Prisma לכל האפליקציה */
export const prisma = new PrismaClient({
  log: env.isProduction || env.isTest ? ['error'] : ['warn', 'error'],
});
