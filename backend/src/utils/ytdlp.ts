import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/** İndirmede yeniden kullanmak için yalnızca gereken alanlar ve ses formatları (~11 KB, tam bilgi ~130 KB). */
const DOWNLOAD_INFO_KEYS = [
  'id', 'title', 'extractor', 'extractor_key', 'webpage_url', 'original_url',
  'webpage_url_basename', 'display_id', 'duration', 'http_headers', '_type', '_version', 'epoch',
] as const;

export type DownloadInfo = Record<string, unknown> & { formats: YtDlpFormat[] };

/**
 * yt-dlp --load-info-json için kırpılmış bilgi. Eşleştirmede zaten çekilen bilgiyle
 * indirmek, ikinci kez bilgi çekmeyi atlar (ölçümde 3,5 sn → 1,0 sn).
 */
export function trimInfoForDownload(info: YtDlpVideoInfo): DownloadInfo | null {
  const raw = info as unknown as Record<string, unknown>;
  const formats = (info.formats ?? []).filter((f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  if (formats.length === 0 || !raw.extractor) return null;
  const trimmed: DownloadInfo = { formats };
  for (const key of DOWNLOAD_INFO_KEYS) if (key in raw) trimmed[key] = raw[key];
  return trimmed;
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

/**
 * yt-dlp binary seçimi:
 *  1. YTDLP_PATH (masaüstü uygulaması bunu ayarlar)
 *  2. vendor/yt-dlp/yt-dlp.exe — "npm run setup:binaries" ile gelen klasör sürümü.
 *     Tek dosyalık exe her çağrıda kendini geçici klasöre açtığı için ~0,85 sn daha yavaş başlar.
 *  3. yt-dlp-exec paketinin tek dosyalık exe'si
 */
const VENDOR_YTDLP = fileURLToPath(new URL('../../../vendor/yt-dlp/yt-dlp.exe', import.meta.url));
const binaryPath = env.YTDLP_PATH ?? (process.platform === 'win32' && existsSync(VENDOR_YTDLP) ? VENDOR_YTDLP : undefined);
const runner: ReturnType<typeof createYtDlp> = binaryPath
  ? createYtDlp(binaryPath)
  : (ytdlp as unknown as ReturnType<typeof createYtDlp>);

/**
 * HLS/DASH manifestleri istenmez: kullandığımız ses formatları doğrudan HTTPS'tir.
 * Bilgi çekmeyi ölçümlerde ~0,5 sn hızlandırır.
 */
const EXTRACTOR_ARGS = 'youtube:skip=hls,dash,translated_subs';

/** Ortak bayraklar (cookies vb.) eklenmiş ham yt-dlp süreci — indirme için. */
export function ytDlpProcess(url: string, flags: YtDlpFlags, options: { timeout?: number } = {}) {
  const allFlags: YtDlpFlags = {
    noWarnings: true,
    extractorArgs: EXTRACTOR_ARGS,
    ...(env.YTDLP_COOKIES_FILE ? { cookies: env.YTDLP_COOKIES_FILE } : {}),
    ...flags,
  };
  return runner.exec(url, allFlags, options);
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
