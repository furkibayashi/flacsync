import 'dotenv/config';
import { z } from 'zod';

/** `KEY=` şeklinde boş bırakılan değerleri `undefined` kabul eder. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const bool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true' || v === '1'));

const EnvSchema = z.object({
  // --- Sunucu ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Tanımlıysa loglar stdout yerine bu dosyaya yazılır (masaüstü uygulaması) */
  LOG_FILE: optionalString,
  /** Frontend build klasörü; boşsa ../../frontend/dist */
  FRONTEND_DIST: optionalString,
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // --- Spotify ---
  SPOTIFY_CLIENT_ID: optionalString,
  SPOTIFY_CLIENT_SECRET: optionalString,
  SPOTIFY_MARKET: z.string().length(2).default('TR'),

  // --- Apple Music ---
  APPLE_MUSIC_TEAM_ID: optionalString,
  APPLE_MUSIC_KEY_ID: optionalString,
  APPLE_MUSIC_PRIVATE_KEY_PATH: optionalString,
  APPLE_MUSIC_PRIVATE_KEY: optionalString,
  APPLE_MUSIC_STOREFRONT: z.string().length(2).default('tr'),
  APPLE_MUSIC_USE_ITUNES_FALLBACK: bool(true),

  // --- Deezer ---
  DEEZER_API_BASE_URL: z.string().url().default('https://api.deezer.com'),

  // --- YouTube ---
  YOUTUBE_API_KEY: optionalString,

  // --- Diğer metadata kaynakları ---
  ODESLI_API_KEY: optionalString,
  MUSICBRAINZ_USER_AGENT: optionalString,

  // --- Eşleştirme ---
  MATCH_DURATION_TOLERANCE_MS: z.coerce.number().int().positive().default(3000),
  MATCH_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.75),
  MATCH_MAX_CANDIDATES: z.coerce.number().int().positive().default(5),

  // --- Audio Resolver ---
  RESOLVER_DURATION_TOLERANCE_MS: z.coerce.number().int().positive().default(5000),
  RESOLVER_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.8),
  RESOLVER_CACHE_TTL_MS: z.coerce.number().int().positive().default(60 * 60_000),
  YTDLP_CONCURRENCY: z.coerce.number().int().positive().default(4),
  /** İndirme geçmişi (ana sayfa) ve kalıcı veriler */
  DATA_DIR: z.string().default('./storage/data'),

  // --- İndirme / dönüştürme ---
  DOWNLOAD_DIR: z.string().default('./storage/downloads'),
  TEMP_DIR: z.string().default('./storage/temp'),
  DEFAULT_AUDIO_FORMAT: z.enum(['flac', 'mp3']).default('flac'),
  MP3_BITRATE: z.coerce.number().int().positive().default(320),
  FLAC_COMPRESSION_LEVEL: z.coerce.number().int().min(0).max(12).default(5),
  /** LAME hız/kalite: 0 en yavaş … 9 en hızlı (320 kbps'de 7 ile fark duyulmaz) */
  MP3_ENCODER_SPEED: z.coerce.number().int().min(0).max(9).default(7),
  MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().positive().default(4),
  DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  FILE_RETENTION_MINUTES: z.coerce.number().int().positive().default(60),
  YTDLP_PATH: optionalString,
  FFMPEG_PATH: optionalString,
  YTDLP_COOKIES_FILE: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Geçersiz ortam değişkenleri:\n${issues}`);
  }
  return result.data;
}

export const env: Env = loadEnv();
