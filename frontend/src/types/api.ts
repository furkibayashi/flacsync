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
  genre?: string | null;
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
  previewUrl?: string | null;
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
  /** Masaüstünde kaydedilecek alt klasör; seçilmiş tek tek şarkılarda null */
  folder: string | null;
  format: OutputFormat;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
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
  previewUrl: string | null;
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

export interface SearchResponse {
  query: string;
  best: SearchResult | null;
  results: SearchResult[];
  albums: AlbumResult[];
  sources: Record<Platform, 'ok' | 'empty' | 'error' | 'skipped'>;
}

export type JobStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'converting'
  | 'tagging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobTimings {
  waited: number;
  metadata: number;
  resolve: number;
  download: number;
  total: number;
}

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
  file: { name: string; size: number; mimeType: string; hasCover: boolean; lyrics?: 'synced' | 'plain' | null } | null;
  error: { code: string; message: string; status: number } | null;
  timings: JobTimings | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueSnapshot {
  jobs: DownloadJob[];
  batches: Batch[];
  stats: { active: number; queued: number; completed: number; failed: number; cancelled: number };
}

export interface HistoryEntry {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  format: OutputFormat;
  fileName: string;
  size: number;
  platform: Platform | null;
  sourceUrl: string;
  collection: string | null;
  durationMs: number | null;
  completedAt: string;
}

export interface HistoryResponse {
  items: HistoryEntry[];
  total: number;
  stats: { total: number; totalBytes: number; last7Days: number; formats: Record<OutputFormat, number> };
}

// --- Keşfet ---------------------------------------------------------------------

export interface DiscoverGenre {
  id: number;
  key: string;
}

export interface DiscoverTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  releaseYear: string | null;
  genre: string | null;
  url: string;
  rank: number;
}

export interface DiscoverAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseYear: string | null;
  trackCount: number | null;
  url: string;
}

export interface DiscoverResponse {
  genreId: number;
  country: string;
  tracks: DiscoverTrack[];
  albums: DiscoverAlbum[];
}

// --- Kütüphane ---------------------------------------------------------------

export interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  year: string | null;
  trackNumber: number | null;
  duration: number | null;
  format: OutputFormat;
  size: number;
  coverUrl: string | null;
  addedAt: string;
  relativePath: string;
}

export interface LibraryResponse {
  tracks: LibraryTrack[];
  genres: { name: string; count: number }[];
  totalBytes: number;
  dir: string;
}

// --- Sanatçı ------------------------------------------------------------------

export interface ArtistSummary {
  id: string;
  name: string;
  pictureUrl: string | null;
  fans: number | null;
}

export interface ArtistTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  duration: number | null;
  previewUrl: string | null;
  url: string;
}

export interface ArtistAlbum {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseYear: string | null;
  type: 'album' | 'single' | 'ep' | 'compilation';
  url: string;
}

export interface ArtistProfile {
  artist: ArtistSummary & { albumCount: number | null };
  topTracks: ArtistTrack[];
  albums: ArtistAlbum[];
  related: ArtistSummary[];
}

// --- Şarkı sözleri ------------------------------------------------------------

export interface Lyrics {
  source: 'lrclib' | 'embedded';
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
}

export type LyricsEmbedResult =
  | { status: 'embedded'; synced: boolean }
  | { status: 'not-found' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; code: string; message: string };
