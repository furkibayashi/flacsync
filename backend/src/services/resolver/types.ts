import type { DownloadInfo } from '../../utils/ytdlp.js';

export type MatchStrategy = 'isrc' | 'ytmusic-search' | 'youtube-search';

export interface AudioFormat {
  formatId: string;
  /** webm | m4a | mp4 ... */
  container: string;
  /** opus | mp4a.40.2 (AAC) ... */
  codec: string;
  bitrateKbps: number | null;
  sampleRate: number | null;
  /** bayt; bilinmiyorsa null */
  filesize: number | null;
  protocol: string;
  /** YouTube'daki tüm akışlar kayıplıdır; kayıpsız kaynak eklenirse true olabilir. */
  isLossless: boolean;
}

export interface MatchInfo {
  strategy: MatchStrategy;
  /** 0-1 */
  score: number;
  /** saniye; kaynakta süre yoksa null */
  durationDiff: number | null;
  title: string;
  artist: string;
  album: string | null;
}

export interface ResolvedSource {
  provider: 'youtube-music';
  videoId: string;
  pageUrl: string;
  /**
   * Doğrudan ses akışı URL'si. Sunucunun IP'sine bağlıdır ve `expiresAt`
   * zamanında geçersizleşir → indirme sunucu tarafında yapılmalı.
   */
  streamUrl: string;
  httpHeaders: Record<string, string>;
  expiresAt: string | null;
  format: AudioFormat;
  match: MatchInfo;
  /** Deezer'ın herkese açık 30 sn önizlemesi (arayüzde dinletme için) */
  previewUrl: string | null;
  /** İç kullanım: indirmede bilgiyi yeniden çekmemek için kırpılmış yt-dlp bilgisi (istemciye gönderilmez) */
  downloadInfo?: DownloadInfo | null;
}

export type ResolverErrorCode = 'NO_MATCH' | 'NO_AUDIO_FORMAT' | 'PROVIDER_ERROR';

const STATUS_BY_CODE: Record<ResolverErrorCode, number> = {
  NO_MATCH: 404,
  NO_AUDIO_FORMAT: 502,
  PROVIDER_ERROR: 502,
};

export class ResolverError extends Error {
  constructor(
    readonly code: ResolverErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ResolverError';
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }
}
