import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { apiRouter } from './routes/api.js';
import { logger } from './utils/logger.js';

/** Production'da frontend build'i (frontend/dist) aynı sunucudan servis edilir. */
const FRONTEND_DIST = env.FRONTEND_DIST ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url));

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Kapaklar müzik CDN'lerinden, önizleme sesi Deezer CDN'inden gelir
          imgSrc: ["'self'", 'data:', 'https:'],
          mediaSrc: ["'self'", 'https:'],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      exposedHeaders: ['Content-Disposition', 'Location'],
    }),
  );

  app.use(express.json({ limit: '64kb' }));

  app.use(
    pinoHttp({
      logger,
      // SSE bağlantıları uzun sürer; her biri için tamamlanma logu gürültü yaratır
      autoLogging: { ignore: (req) => req.url?.endsWith('/events') ?? false },
    }),
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Çok fazla istek, biraz sonra tekrar deneyin' } },
    }),
  );

  app.use('/api', apiRouter);
  app.use('/api', notFoundHandler);

  if (existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST, { index: false, maxAge: '1h' }));
    // SPA: /api dışındaki GET isteklerine index.html
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(join(FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
