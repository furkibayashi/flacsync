import { EventEmitter } from 'node:events';

/**
 * İndirme hatalarını anlaşılır kodlara çevirir.
 *
 * yt-dlp hatası tek bir stderr satırı olarak gelir ("ERROR: [youtube] …: Sign in to confirm …").
 * Kullanıcıya ham satır yerine ne olduğunu ve ne yapacağını söylemek, otomatik yeniden denemeye
 * ve yt-dlp'yi kendiliğinden güncellemeye karar vermek için sınıflandırılır.
 */

export type DownloadFailureCode =
  /** YouTube değişti, yt-dlp güncel değil (imza / nsig / format çıkarılamadı) */
  | 'YTDLP_OUTDATED'
  /** "Robot olmadığınızı doğrulayın" — çok istek ya da IP engeli; bekleyip denemek / çerez */
  | 'YTDLP_BOT_CHECK'
  /** HTTP 429 */
  | 'YTDLP_RATE_LIMITED'
  /** HTTP 403 — çoğu zaman süresi dolan akış linki ya da eski yt-dlp */
  | 'YTDLP_FORBIDDEN'
  /** Video silinmiş / gizli / bölgede yok */
  | 'YTDLP_UNAVAILABLE'
  | 'YTDLP_GEO_BLOCKED'
  /** İnternet bağlantısı / DNS / zaman aşımı */
  | 'CONNECTION_ERROR'
  /** Dönüştürme (ffmpeg) başarısız */
  | 'FFMPEG_FAILED'
  | 'DownloadError';

const RULES: Array<[DownloadFailureCode, RegExp]> = [
  ['YTDLP_BOT_CHECK', /sign in to confirm|not a bot|confirm you.?re not a robot/i],
  ['YTDLP_RATE_LIMITED', /http error 429|too many requests/i],
  ['YTDLP_GEO_BLOCKED', /not available in your country|geo.?restrict|blocked it in your country/i],
  ['YTDLP_UNAVAILABLE', /video unavailable|private video|has been removed|account .* terminated|this video is not available/i],
  [
    'YTDLP_OUTDATED',
    /nsig extraction failed|signature extraction failed|unable to extract|requested format is not available|unsupported url|please (?:report this issue|update)|failed to decrypt|player .* not found|precondition check failed/i,
  ],
  ['YTDLP_FORBIDDEN', /http error 403|forbidden/i],
  [
    'CONNECTION_ERROR',
    /unable to download (?:webpage|api page)|timed out|timeout|connection (?:reset|refused|aborted)|getaddrinfo|enotfound|econnreset|etimedout|eai_again|network is unreachable|socket hang up|temporary failure in name resolution/i,
  ],
  ['FFMPEG_FAILED', /ffmpeg hatası|ffmpeg exited|conversion failed|invalid data found when processing input/i],
];

export function classifyDownloadFailure(text: string | null | undefined): DownloadFailureCode {
  const t = text ?? '';
  for (const [code, re] of RULES) if (re.test(t)) return code;
  return 'DownloadError';
}

/** Kendiliğinden yeniden denemeye değer hatalar (biraz bekleyince geçebilir) */
const TRANSIENT = new Set<string>([
  'CONNECTION_ERROR',
  'YTDLP_RATE_LIMITED',
  'YTDLP_FORBIDDEN',
  'YTDLP_BOT_CHECK',
  'PROVIDER_ERROR',
  'RATE_LIMITED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

export const isTransientFailure = (code: string) => TRANSIENT.has(code);

/** yt-dlp güncellemesinin çözebileceği hatalar */
export const suggestsYtDlpUpdate = (code: string) => code === 'YTDLP_OUTDATED' || code === 'YTDLP_FORBIDDEN';

/**
 * Masaüstü uygulaması dinler: "outdated" gelince yt-dlp'yi kendiliğinden günceller
 * (sunucu tarafı kendi başına binary değiştirmez).
 */
export const downloadHealth = new EventEmitter();
