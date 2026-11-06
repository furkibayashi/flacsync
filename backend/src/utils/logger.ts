import pino from 'pino';
import { env } from '../config/env.js';

const usePretty = env.NODE_ENV === 'development' && !env.LOG_FILE;

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    ...(usePretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  },
  env.LOG_FILE ? pino.destination({ dest: env.LOG_FILE, mkdir: true, sync: false }) : undefined,
);
