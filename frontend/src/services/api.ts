import type {
  Batch,
  BatchItem,
  DownloadJob,
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
  search: (query: string, signal?: AbortSignal) => request<SearchResponse>('/search', post({ query }, signal)),

  parse: (url: string, signal?: AbortSignal) => request<ParseResponse>('/parse', post({ url }, signal)),

  resolve: (url: string, signal?: AbortSignal) => request<ResolveResponse>('/resolve', post({ url }, signal)),

  startDownload: (url: string, format: OutputFormat) => request<DownloadJob>('/download', post({ url, format })),

  getJob: (id: string) => request<DownloadJob>(`/download/${id}`),

  eventsUrl: (id: string) => `${API_BASE}/download/${id}/events`,

  /** `folder`: masaüstü uygulamasında dosyanın kaydedileceği alt klasör */
  fileUrl: (id: string, folder?: string) =>
    `${API_BASE}/download/${id}/file${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`,

  lookup: (url: string, signal?: AbortSignal) => request<LookupResponse>('/lookup', post({ url }, signal)),

  startBatch: (name: string, format: OutputFormat, items: BatchItem[]) =>
    request<Batch>('/batch', post({ name, format, items })),

  getBatch: (id: string) => request<{ batch: Batch; jobs: DownloadJob[] }>(`/batch/${id}`),

  batchEventsUrl: (id: string) => `${API_BASE}/batch/${id}/events`,

  batchZipUrl: (id: string) => `${API_BASE}/batch/${id}/zip`,
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
