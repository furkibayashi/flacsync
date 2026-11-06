import PQueue from 'p-queue';
import ytdlp, { create as createYtDlp } from 'yt-dlp-exec';
import { env } from '../config/env.js';

export type YtDlpFlags = Record<string, string | boolean | number>;

/** yt-dlp format nesnesinin kullandığımız alanları. */
export interface YtDlpFormat {
  format_id: string;
  url?: string;
  ext?: string;
  acodec?: string | null;
  vcodec?: string | null;
  abr?: number | null;
  tbr?: number | null;
  asr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  protocol?: string;
  has_drm?: boolean | null;
  format_note?: string;
  http_headers?: Record<string, string>;
}

/** yt-dlp --dump-single-json çıktısının (video) kullandığımız alanları. */
export interface YtDlpVideoInfo {
  id: string;
  title?: string;
  track?: string;
  artist?: string;
  artists?: string[];
  creator?: string;
  album?: string;
  release_year?: number;
  release_date?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url: string; width?: number; height?: number }[];
  webpage_url?: string;
  formats?: YtDlpFormat[];
}

/** --flat-playlist ile dönen arama sonucu. */
export interface YtDlpFlatEntry {
  id: string;
  title?: string;
  duration?: number | null;
  channel?: string | null;
  uploader?: string | null;
  url?: string;
}

export class YtDlpError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'YtDlpError';
  }

  get isNotFound(): boolean {
    return /video unavailable|private video|has been removed|does not exist|not available/i.test(this.stderr);
  }
}

const DEFAULT_TIMEOUT_MS = 45_000;

/** Aynı anda çalışan yt-dlp süreci sayısını sınırlar (her süreç ~100 MB RAM). */
const queue = new PQueue({ concurrency: env.YTDLP_CONCURRENCY });

/** Varsayılan (paketle gelen) veya YTDLP_PATH ile verilen yt-dlp binary'si. */
const runner: ReturnType<typeof createYtDlp> = env.YTDLP_PATH
  ? createYtDlp(env.YTDLP_PATH)
  : (ytdlp as unknown as ReturnType<typeof createYtDlp>);

/** Ortak bayraklar (cookies vb.) eklenmiş ham yt-dlp süreci — indirme için. */
export function ytDlpProcess(url: string, flags: YtDlpFlags, options: { timeout?: number } = {}) {
  return runner.exec(
    url,
    {
      noWarnings: true,
      ...(env.YTDLP_COOKIES_FILE ? { cookies: env.YTDLP_COOKIES_FILE } : {}),
      ...flags,
    },
    options,
  );
}

/**
 * yt-dlp'yi JSON çıktı modunda çalıştırır. İndirme yapmaz.
 * Cookies dosyası tanımlıysa otomatik eklenir.
 */
export function ytDlpJson<T>(url: string, flags: YtDlpFlags, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return queue.add(
    async () => {
      try {
        const { stdout } = await ytDlpProcess(url, { dumpSingleJson: true, ...flags }, { timeout: timeoutMs });
        return JSON.parse(stdout) as T;
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
        const lastLine = stderr.trim().split('\n').pop() ?? 'bilinmeyen hata';
        throw new YtDlpError(`yt-dlp başarısız: ${lastLine}`, stderr, { cause: err });
      }
    },
    { throwOnTimeout: true },
  );
}
