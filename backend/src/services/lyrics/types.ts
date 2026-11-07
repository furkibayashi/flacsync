/** Şarkı sözü aramak için gereken bilgiler. */
export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string | null;
  /** saniye; LRCLib eşleşmesi ±2 sn toleransla yapılır */
  duration?: number | null;
}

/** LRC'nin tek satırı: zaman (ms) + metin. */
export interface LrcLine {
  timeMs: number;
  text: string;
}

export type LyricsSource = 'lrclib' | 'embedded';

export interface Lyrics {
  source: LyricsSource;
  /** "[00:12.34] satır" biçiminde zaman damgalı metin; yoksa null */
  synced: string | null;
  /** Düz metin (zaman damgasız) */
  plain: string | null;
  instrumental: boolean;
  /** Sağlayıcıdaki kaydın bilgileri (eşleşmenin doğruluğunu görmek için) */
  match: { title: string; artist: string; album: string | null; duration: number | null } | null;
}

/** LRCLib /api/get ve /api/search yanıtındaki kayıt. */
export interface LrcLibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  /** saniye */
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export type EmbedFormat = 'flac' | 'mp3';

/** Gömme işleminin sonucu — servis hiçbir zaman hata fırlatmaz, sonucu döndürür. */
export type EmbedResult =
  | { status: 'embedded'; synced: boolean; source: LyricsSource }
  | { status: 'not-found' }
  | { status: 'skipped'; reason: 'disabled' | 'instrumental' | 'unsupported-format' }
  | { status: 'failed'; code: LyricsErrorCode; message: string };

export type LyricsErrorCode =
  | 'LYRICS_NOT_FOUND'
  | 'LYRICS_PROVIDER_ERROR'
  | 'LYRICS_TIMEOUT'
  | 'LYRICS_INVALID_RESPONSE'
  | 'TAG_WRITE_FAILED'
  | 'UNSUPPORTED_FILE';
