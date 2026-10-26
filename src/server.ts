import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './db/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`✅ EventStyle API running on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`📚 Swagger: http://localhost:${env.PORT}/api-docs`);
  if (!env.cloudinaryConfigured) {
    console.warn('⚠️  Cloudinary is not configured – image uploads will return 503.');
  }
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
