import type { Platform } from '../metadata/types.js';

/** Tek bir platformun arama sonucundaki bir şarkı. */
export interface SearchCandidate {
  source: Platform;
  sourceId: string;
  /** Uygulamanın indirme akışına verilebilecek link */
  url: string;
  title: string;
  /** YouTube Music düz aramasında sanatçı bilinmeyebilir → '' */
  artist: string;
  album: string | null;
  releaseYear: string | null;
  coverUrl: string | null;
  /** saniye */
  duration: number | null;
  isrc: string | null;
  /** Platformun kendi sıralamasındaki yeri (0 = ilk) */
  position: number;
  /** 0-1 popülerlik; bilinmiyorsa null */
  popularity: number | null;
}

/** Aynı kaydın farklı platformlardaki sonuçları birleştirilmiş hali. */
export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  releaseYear: string | null;
  coverUrl: string | null;
  duration: number | null;
  isrc: string | null;
  /** İndirme akışında kullanılacak en zengin link (Deezer > Spotify > Apple > YouTube) */
  url: string;
  /** Kaydın bulunduğu platformlar */
  sources: Platform[];
  links: Partial<Record<Platform, string>>;
  /** 0-1 genel skor */
  score: number;
  /** 0-1 sorguyla eşleşme */
  relevance: number;
}

/** Tek bir platformun albüm arama sonucu. */
export interface AlbumCandidate {
  source: Platform;
  title: string;
  artist: string;
  /** Albüm görünümünü açan link (Deezer / Apple Music albüm linki) */
  url: string;
  coverUrl: string | null;
  trackCount: number | null;
  releaseYear: string | null;
  position: number;
}

export interface AlbumResult {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl: string | null;
  trackCount: number | null;
  releaseYear: string | null;
  sources: Platform[];
  score: number;
}

export type SourceStatus = 'ok' | 'empty' | 'error' | 'skipped';

export interface SearchResponse {
  query: string;
  best: SearchResult | null;
  results: SearchResult[];
  /** Sorguyla güçlü eşleşen albümler (ör. "daft punk discovery") */
  albums: AlbumResult[];
  sources: Record<Platform, SourceStatus>;
}
