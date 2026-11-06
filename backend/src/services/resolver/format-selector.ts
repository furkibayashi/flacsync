import type { YtDlpFormat } from '../../utils/ytdlp.js';
import type { AudioFormat } from './types.js';

/**
 * Aynı bitrate'te Opus, AAC'den daha verimlidir (dinleme testlerinde ~%10-30).
 * Bu yüzden Opus'a küçük bir ağırlık verilir.
 */
const CODEC_WEIGHT: Array<[RegExp, number]> = [
  [/^opus/i, 1.1],
  [/^mp4a/i, 1.0],
  [/^(?:mp3|vorbis)/i, 0.95],
];

function codecWeight(acodec: string): number {
  return CODEC_WEIGHT.find(([re]) => re.test(acodec))?.[1] ?? 0.9;
}

export function isAudioOnly(f: YtDlpFormat): boolean {
  return Boolean(
    f.url &&
      f.acodec &&
      f.acodec !== 'none' &&
      (!f.vcodec || f.vcodec === 'none') &&
      !f.has_drm,
  );
}

/** Formatın "algılanan kalite" puanı: bitrate × codec verimi × protokol tercihi. */
export function rankAudioFormat(f: YtDlpFormat): number {
  const bitrate = f.abr ?? f.tbr ?? 0;
  // Tek parça HTTPS indirme, HLS/DASH parçalı akıştan daha güvenilir
  const protocol = f.protocol === 'https' || f.protocol === 'http' ? 1 : 0.9;
  return bitrate * codecWeight(f.acodec ?? '') * protocol;
}

/** DRM'siz, yalnızca ses içeren en kaliteli formatı seçer. */
export function selectBestAudioFormat(formats: YtDlpFormat[] | undefined): YtDlpFormat | null {
  const candidates = (formats ?? []).filter(isAudioOnly);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, f) => (rankAudioFormat(f) > rankAudioFormat(best) ? f : best));
}

export function toAudioFormat(f: YtDlpFormat): AudioFormat {
  const bitrate = f.abr ?? f.tbr;
  return {
    formatId: f.format_id,
    container: f.ext ?? 'unknown',
    codec: f.acodec ?? 'unknown',
    bitrateKbps: bitrate ? Math.round(bitrate) : null,
    sampleRate: f.asr ?? null,
    filesize: f.filesize ?? f.filesize_approx ?? null,
    protocol: f.protocol ?? 'unknown',
    isLossless: /^(?:flac|alac|pcm|wav)/i.test(f.acodec ?? ''),
  };
}

/** googlevideo URL'lerindeki `expire` (epoch sn) parametresini okur. */
export function streamExpiry(url: string): Date | null {
  try {
    const expire = Number(new URL(url).searchParams.get('expire'));
    return Number.isFinite(expire) && expire > 0 ? new Date(expire * 1000) : null;
  } catch {
    return null;
  }
}
