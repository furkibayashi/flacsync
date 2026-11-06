// Backend yanıt tipleri (backend/src/services/* ile birebir)

export type Platform = 'spotify' | 'apple-music' | 'deezer' | 'youtube-music';
export type OutputFormat = 'mp3' | 'flac';

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  coverUrl: string | null;
  isrc: string | null;
  duration: number | null;
}

export interface ParseResponse {
  platform: Platform;
  sourceId: string;
  sourceUrl: string;
  metadata: TrackMetadata;
  enrichedFrom: Platform[];
}

export interface AudioFormat {
  formatId: string;
  container: string;
  codec: string;
  bitrateKbps: number | null;
  sampleRate: number | null;
  filesize: number | null;
  protocol: string;
  isLossless: boolean;
}

export interface ResolvedSource {
  provider: 'youtube-music';
  videoId: string;
  pageUrl: string;
  expiresAt: string | null;
  format: AudioFormat;
  match: {
    strategy: 'isrc' | 'ytmusic-search' | 'youtube-search';
    score: number;
    durationDiff: number | null;
    title: string;
    artist: string;
    album: string | null;
  };
  previewUrl: string | null;
}

export interface ResolveResponse {
  metadata: TrackMetadata;
  source: ResolvedSource;
}

export interface CollectionTrack {
  position: number;
  disc: number | null;
  title: string;
  artist: string;
  duration: number | null;
  isrc: string | null;
  url: string;
}

export interface Collection {
  platform: Platform;
  type: 'album' | 'playlist';
  id: string;
  url: string;
  title: string;
  artist: string | null;
  coverUrl: string | null;
  releaseYear: string | null;
  tracks: CollectionTrack[];
  totalTracks: number;
}

export type LookupResponse = ({ kind: 'track' } & ParseResponse) | { kind: 'collection'; collection: Collection };

export interface BatchItem {
  url: string;
  overrides?: { album?: string; releaseDate?: string; coverUrl?: string };
  extras?: { trackNumber?: number; trackTotal?: number; discNumber?: number; albumArtist?: string };
}

export interface Batch {
  id: string;
  name: string;
  folder: string;
  format: OutputFormat;
  total: number;
  completed: number;
  failed: number;
  progress: number;
  status: 'running' | 'completed' | 'partial' | 'failed';
  createdAt: string;
  jobIds: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  releaseYear: string | null;
  coverUrl: string | null;
  duration: number | null;
  isrc: string | null;
  url: string;
  sources: Platform[];
  links: Partial<Record<Platform, string>>;
  score: number;
  relevance: number;
}

export interface SearchResponse {
  query: string;
  best: SearchResult | null;
  results: SearchResult[];
  sources: Record<Platform, 'ok' | 'empty' | 'error' | 'skipped'>;
}

export type JobStatus = 'queued' | 'resolving' | 'downloading' | 'converting' | 'tagging' | 'completed' | 'failed';

export interface DownloadJob {
  id: string;
  url: string;
  format: OutputFormat;
  batchId: string | null;
  status: JobStatus;
  progress: number;
  message: string;
  platform: Platform | null;
  metadata: TrackMetadata | null;
  source: ResolvedSource | null;
  file: { name: string; size: number; mimeType: string; hasCover: boolean } | null;
  error: { code: string; message: string; status: number } | null;
  createdAt: string;
  updatedAt: string;
}
