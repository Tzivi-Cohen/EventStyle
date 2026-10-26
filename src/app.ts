import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { apiRouter } from './routes';
import { openApiDocument } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimit';
import { HttpError } from './errors/HttpError';

export function createApp() {
  const app = express();

  // Render ו-Neon יושבים מאחורי Proxy – נדרש כדי לזהות IP אמיתי בהגבלת קצב
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Render מספק HTTPS בעצמו; ההגדרה הזו שוברת את Swagger ב-http://localhost
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        // בקשות ללא Origin (Postman, curl, Swagger באותו דומיין) מותרות
        if (!origin || env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(HttpError.forbidden(`Origin ${origin} is not allowed by CORS`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.json({ name: 'EventStyle API', docs: '/api-docs', health: '/api/health' });
  });

  // כתובת קצרה ל-Swagger (כמו בצ'קליסט: http://localhost:4000/docs/)
  app.get(['/docs', '/docs/'], (_req, res) => {
    res.redirect('/api-docs/');
  });

  // Swagger / OpenAPI
  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'EventStyle API Docs',
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  app.use('/api', apiRateLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
