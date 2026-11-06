export const PLATFORMS = ['spotify', 'apple-music', 'deezer', 'youtube-music'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ResourceType = 'track' | 'album' | 'playlist' | 'artist';

/**
 * Tüm platformların dönüştürüldüğü standart format.
 * Kaynakta bulunamayan alanlar `null` döner (uydurulmaz).
 */
export interface TrackMetadata {
  title: string;
  /** Birden fazla ana sanatçı varsa ", " ile birleştirilir. */
  artist: string;
  album: string | null;
  /** Yalnızca yıl: "2024" */
  releaseDate: string | null;
  coverUrl: string | null;
  /** Büyük harf, tiresiz ISRC: "USUM71703861" */
  isrc: string | null;
  /** Saniye cinsinden */
  duration: number | null;
}

export interface ParsedMusicUrl {
  platform: Platform;
  type: ResourceType;
  /** Platforma özgü kimlik (Spotify base62, Apple/Deezer sayısal, YouTube video id) */
  id: string;
  /** Apple Music storefront'u (ör. "tr", "us") */
  storefront?: string;
  /** Kısa linkler açıldıktan sonraki URL */
  url: string;
}

export interface MetadataProvider {
  readonly platform: Platform;
  getTrack(parsed: ParsedMusicUrl): Promise<TrackMetadata>;
  /** Albüm / çalma listesi parça listesi */
  getCollection?(parsed: ParsedMusicUrl): Promise<Collection>;
}

export type CollectionType = 'album' | 'playlist';

export interface CollectionTrack {
  /** Albümde parça numarası, çalma listesinde sıra (1'den başlar) */
  position: number;
  disc: number | null;
  title: string;
  artist: string;
  /** saniye */
  duration: number | null;
  isrc: string | null;
  /** Bu parçanın kendi platformundaki linki — indirme akışına verilir */
  url: string;
}

export interface Collection {
  platform: Platform;
  type: CollectionType;
  id: string;
  url: string;
  title: string;
  /** Albüm sanatçısı ya da çalma listesinin sahibi */
  artist: string | null;
  coverUrl: string | null;
  releaseYear: string | null;
  tracks: CollectionTrack[];
  /** Platformdaki toplam parça sayısı (liste kırpıldıysa tracks.length'ten büyük) */
  totalTracks: number;
}

export interface ExtractionResult {
  platform: Platform;
  sourceId: string;
  sourceUrl: string;
  metadata: TrackMetadata;
  /** Eksik alanların doldurulduğu ikincil kaynaklar */
  enrichedFrom: Platform[];
}
