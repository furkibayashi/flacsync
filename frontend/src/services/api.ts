import type {
  AlbumResult,
  ArtistProfile,
  ArtistSummary,
  Lyrics,
  LyricsEmbedResult,
  Batch,
  BatchItem,
  DiscoverGenre,
  DiscoverResponse,
  LibraryResponse,
  DownloadJob,
  HistoryResponse,
  QueueSnapshot,
  LookupResponse,
  OutputFormat,
  ParseResponse,
  ResolveResponse,
  SearchResponse,
} from '../types/api';

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Arayüzde gösterilecek hata: kod (çeviri için) + sunucu mesajı (yedek). */
export interface UiError {
  code: string;
  message: string;
}

export function toUiError(err: unknown): UiError {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: err.name, message: err.message };
  return { code: 'UNKNOWN', message: String(err) };
}

export const isAbort = (err: unknown) => (err as Error | undefined)?.name === 'AbortError';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamadı');
  }

  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? `HTTP_${res.status}`,
      body?.error?.message ?? `HTTP ${res.status}`,
    );
  }
  return body as T;
}

const post = (body: unknown, signal?: AbortSignal) =>
  ({ method: 'POST', body: JSON.stringify(body), signal }) satisfies RequestInit;

export const api = {
  parse: (url: string, signal?: AbortSignal) => request<ParseResponse>('/parse', post({ url }, signal)),

  resolve: (url: string, signal?: AbortSignal) => request<ResolveResponse>('/resolve', post({ url }, signal)),

  startDownload: (url: string, format: OutputFormat) => request<DownloadJob>('/download', post({ url, format })),

  getJob: (id: string) => request<DownloadJob>(`/download/${id}`),

  eventsUrl: (id: string) => `${API_BASE}/download/${id}/events`,

  /** `folder`: masaüstü uygulamasında dosyanın kaydedileceği alt klasör */
  fileUrl: (id: string, folder?: string) =>
    `${API_BASE}/download/${id}/file${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`,

  lookup: (url: string, signal?: AbortSignal) => request<LookupResponse>('/lookup', post({ url }, signal)),

  albumOf: (artist: string, album: string, signal?: AbortSignal) =>
    request<{ album: AlbumResult | null }>('/album-of', post({ artist, album }, signal)),

  startBatch: (name: string, format: OutputFormat, items: BatchItem[], useFolder = true) =>
    request<Batch>('/batch', post({ name, format, items, useFolder })),

  search: (query: string, signal?: AbortSignal, limit = 8) =>
    request<SearchResponse>('/search', post({ query, limit }, signal)),

  queue: () => request<QueueSnapshot>('/queue'),

  queueEventsUrl: () => `${API_BASE}/queue/events`,

  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/download/${id}/cancel`, post({})),

  retryJob: (id: string) => request<DownloadJob>(`/download/${id}/retry`, post({})),

  clearFinished: () => request<{ removed: number }>('/queue/finished', { method: 'DELETE' }),

  history: (limit = 50, offset = 0) => request<HistoryResponse>(`/history?limit=${limit}&offset=${offset}`),

  removeHistory: (id: string) => request<{ removed: boolean }>(`/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getBatch: (id: string) => request<{ batch: Batch; jobs: DownloadJob[] }>(`/batch/${id}`),

  batchEventsUrl: (id: string) => `${API_BASE}/batch/${id}/events`,

  batchZipUrl: (id: string) => `${API_BASE}/batch/${id}/zip`,

  discoverGenres: () => request<{ genres: DiscoverGenre[]; countries: string[] }>('/discover/genres'),

  discover: (genre: number, country: string, signal?: AbortSignal) =>
    request<DiscoverResponse>(`/discover?genre=${genre}&country=${country}`, { signal }),

  library: (signal?: AbortSignal) => request<LibraryResponse>('/library', { signal }),

  rescanLibrary: () => request<{ added: number; removed: number }>('/library/rescan', post({})),

  removeFromLibrary: (id: string) => request<{ removed: boolean }>(`/library/tracks/${id}`, { method: 'DELETE' }),

  libraryStreamUrl: (id: string) => `${API_BASE}/library/tracks/${id}/stream`,

  libraryCoverUrl: (id: string) => `${API_BASE}/library/tracks/${id}/cover`,

  findArtist: (name: string, signal?: AbortSignal) =>
    request<{ artist: ArtistSummary | null }>(`/artist/find?name=${encodeURIComponent(name)}`, { signal }),

  artist: (id: string, signal?: AbortSignal) => request<ArtistProfile>(`/artist/${encodeURIComponent(id)}`, { signal }),

  libraryLyrics: (id: string, signal?: AbortSignal) =>
    request<{ lyrics: Lyrics | null }>(`/library/tracks/${id}/lyrics`, { signal }),

  embedLyrics: (id: string) => request<LyricsEmbedResult>(`/library/tracks/${id}/lyrics`, post({})),

  lyrics: (q: { title: string; artist: string; album?: string | null; duration?: number | null }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ title: q.title, artist: q.artist });
    if (q.album) params.set('album', q.album);
    if (q.duration) params.set('duration', String(Math.round(q.duration)));
    return request<{ lyrics: Lyrics | null }>(`/lyrics?${params}`, { signal });
  },
};

/** Masaüstü (Electron) uygulamasında mı çalışıyoruz? Orada dosyalar klasöre otomatik kaydedilir. */
export const isDesktopApp =
  typeof window !== 'undefined' && (Boolean(window.flacsync) || /Electron/i.test(navigator.userAgent));

/** Masaüstünde kaydedilen dosyayı Gezgin'de göster (köprü yoksa kayıt klasörünü açar). */
export function revealSavedFile(jobId: string): void {
  void window.flacsync?.revealFile(jobId);
}

/** Masaüstünde Windows "Farklı kaydet" penceresi; seçilen yolu döndürür (iptalde null). */
export async function saveFileAs(jobId: string): Promise<string | null> {
  return (await window.flacsync?.saveAs(jobId)) ?? null;
}

export function openSaveFolder(folder?: string): void {
  void window.flacsync?.openSaveFolder(folder);
}
