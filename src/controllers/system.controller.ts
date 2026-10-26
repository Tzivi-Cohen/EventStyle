import type { Request, Response } from 'express';
import { prisma } from '../db/prisma';

/** בדיקת פעילות: השרת עובד + חיבור למסד הנתונים */
export async function health(_req: Request, res: Response) {
  let database: 'ok' | 'unreachable' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'unreachable';
  }
  res.status(database === 'ok' ? 200 : 503).json({
    status: database === 'ok' ? 'ok' : 'error',
    database,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
