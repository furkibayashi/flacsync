import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { historyService } from './services/history.service.js';
import { jobsService } from './services/jobs.service.js';
import { prefsService } from './services/prefs.service.js';
import { syncService } from './services/sync.service.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await Promise.all([
    mkdir(resolve(env.DOWNLOAD_DIR), { recursive: true }),
    mkdir(resolve(env.TEMP_DIR), { recursive: true }),
  ]);

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`API hazır → http://${env.HOST}:${env.PORT}/api (ortam: ${env.NODE_ENV})`);
  });
  jobsService.restore();
  jobsService.startSweeper();
  syncService.start();

  const shutdown = (signal: string) => {
    logger.info(`${signal} alındı, sunucu kapatılıyor`);
    jobsService.stopSweeper();
    void Promise.all([historyService.flush(), jobsService.flush(), prefsService.flush()]).finally(() => server.close(() => process.exit(0)));
    // Açık SSE bağlantıları kapanmayı engellemesin
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Sunucu başlatılamadı');
  process.exit(1);
});
