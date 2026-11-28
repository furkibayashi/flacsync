import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import PQueue from 'p-queue';
import sanitizeFilename from 'sanitize-filename';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import {
  classifyDownloadFailure,
  downloadHealth,
  isTransientFailure,
  suggestsYtDlpUpdate,
} from '../utils/download-errors.js';
import { JsonStore } from '../utils/json-store.js';
import { logger } from '../utils/logger.js';
import { downloaderService, type DownloadedFile, type OutputFormat, type TagExtras } from './downloader.service.js';
import { historyService } from './history.service.js';
import { genreService } from './genre.service.js';
import { libraryService } from './library.service.js';
import { metadataService } from './metadata.service.js';
import type { Platform, TrackMetadata } from './metadata/types.js';
import { resolverService } from './resolver.service.js';
import type { ResolvedSource } from './resolver/types.js';

export type JobStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'converting'
  | 'tagging'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** İstemciye gönderilen kaynak bilgisi — IP'ye bağlı akış URL'si, header'lar ve iç bilgi hariç. */
export type PublicSource = Omit<ResolvedSource, 'streamUrl' | 'httpHeaders' | 'downloadInfo'>;

/** Albüm indirmelerinde tüm parçalara ortak yazılan alanlar */
export type MetadataOverrides = Partial<Pick<TrackMetadata, 'album' | 'releaseDate' | 'coverUrl'>>;

export interface JobOptions {
  overrides?: MetadataOverrides;
  extras?: TagExtras;
  batchId?: string;
}

export interface JobTimings {
  /** Sırada bekleme */
  waited: number;
  metadata: number;
  resolve: number;
  /** İndirme + dönüştürme + etiketleme */
  download: number;
  total: number;
}

export interface PublicJob {
  id: string;
  url: string;
  format: OutputFormat;
  batchId: string | null;
  status: JobStatus;
  /** Genel ilerleme, 0-100 */
  progress: number;
  message: string;
  platform: Platform | null;
  metadata: TrackMetadata | null;
  source: PublicSource | null;
  file: { name: string; size: number; mimeType: string; hasCover: boolean; lyrics: 'synced' | 'plain' | null } | null;
  error: { code: string; message: string; status: number } | null;
  /** Aşama süreleri (ms) — tamamlanınca dolar */
  timings: JobTimings | null;
  /** Kaçıncı deneme (geçici hatalarda kendiliğinden yeniden denenir) */
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

interface InternalJob extends PublicJob {
  options: JobOptions;
  filePath: string | null;
  abort: AbortController;
  done: Promise<void>;
}

export type BatchStatus = 'running' | 'completed' | 'partial' | 'failed';

export interface BatchItem {
  url: string;
  overrides?: MetadataOverrides;
  extras?: TagExtras;
}

export interface PublicBatch {
  id: string;
  name: string;
  /** Masaüstünde kaydedilecek alt klasör; seçilmiş tek tek şarkılarda null (ana klasöre kaydedilir) */
  folder: string | null;
  format: OutputFormat;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Ortalama ilerleme, 0-100 */
  progress: number;
  status: BatchStatus;
  createdAt: string;
  jobIds: string[];
}

interface BatchRecord {
  id: string;
  name: string;
  folder: string | null;
  format: OutputFormat;
  jobIds: string[];
  createdAt: string;
}

/** Art arda çok iş başarısız olunca kuyruk duraklatılır (bağlantı kopması, YouTube engeli…) */
export interface QueueState {
  paused: boolean;
  /** Duraklatma nedeni olan hata kodu */
  reason: string | null;
  pausedAt: string | null;
}

export interface QueueSnapshot {
  jobs: PublicJob[];
  batches: PublicBatch[];
  stats: { active: number; queued: number; completed: number; failed: number; cancelled: number };
  state: QueueState;
}

/** Diske yazılan iş (uygulama kapanıp açılınca kaldığı yerden devam için) */
interface StoredJob {
  id: string;
  url: string;
  format: OutputFormat;
  options: JobOptions;
  status: 'queued' | 'failed' | 'cancelled';
  error: PublicJob['error'];
  metadata: TrackMetadata | null;
  createdAt: string;
}

interface StoredQueue {
  jobs: StoredJob[];
  batches: BatchRecord[];
}

const MAX_ATTEMPTS = 3;
/** 1. ve 2. yeniden denemeden önce bekleme (ms) */
const BACKOFF_MS = [8_000, 30_000];
/** Bu kadar iş art arda (yeniden denemelere rağmen) geçici hatayla biterse kuyruk durur */
const PAUSE_AFTER_FAILURES = 5;
/** Başarısız işlerin "yeniden dene" için tutulduğu süre */
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** Aşamaların genel ilerleme çubuğundaki payı */
const STAGE_RANGE: Record<'resolving' | 'downloading' | 'converting' | 'tagging', [number, number]> = {
  resolving: [0, 15],
  downloading: [15, 75],
  converting: [75, 96],
  tagging: [96, 100],
};

const STAGE_MESSAGE: Record<JobStatus, string> = {
  queued: 'Sırada bekliyor',
  resolving: 'Ses kaynağı aranıyor',
  downloading: 'İndiriliyor',
  converting: 'Dönüştürülüyor',
  tagging: 'Etiketler ve kapak gömülüyor',
  completed: 'Hazır',
  failed: 'Başarısız',
  cancelled: 'İptal edildi',
};

export function toPublicSource(source: ResolvedSource): PublicSource {
  const { streamUrl: _streamUrl, httpHeaders: _headers, downloadInfo: _info, ...rest } = source;
  return rest;
}

export function folderName(name: string): string {
  // Baştaki/sondaki nokta ve boşluklar önce kırpılır (aksi halde sanitize "_" ile değiştirir)
  const trim = (s: string) => s.replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  return trim(sanitizeFilename(trim(name), { replacement: '_' })).slice(0, 120) || 'FlacSync';
}

function applyOverrides(meta: TrackMetadata, overrides: MetadataOverrides = {}): TrackMetadata {
  return {
    ...meta,
    album: overrides.album ?? meta.album,
    releaseDate: overrides.releaseDate ?? meta.releaseDate,
    coverUrl: overrides.coverUrl ?? meta.coverUrl,
  };
}

const GENERIC_CODES = new Set(['DownloadError', 'YtDlpError', 'ERROR', 'Error', 'PROVIDER_ERROR', 'AxiosError']);

export function errorInfo(err: unknown): { code: string; message: string; status: number } {
  const e = err as { code?: unknown; name?: string; message?: string; statusCode?: unknown; stderr?: unknown };
  let code = typeof e.code === 'string' ? e.code : e.name ?? 'ERROR';
  // Genel kodlar: yt-dlp / ağ çıktısından anlamlı koda çevrilir (kullanıcıya doğru ipucu için)
  if (GENERIC_CODES.has(code)) {
    const detail = `${e.message ?? ''} ${typeof e.stderr === 'string' ? e.stderr : ''} ${String((e as { cause?: { message?: string } }).cause?.message ?? '')}`;
    const refined = classifyDownloadFailure(detail);
    if (refined !== 'DownloadError' || code === 'DownloadError') code = refined === 'DownloadError' ? code : refined;
  }
  return {
    code,
    message: e.message ?? 'Bilinmeyen hata',
    status: typeof e.statusCode === 'number' ? e.statusCode : 500,
  };
}

export const isTerminalStatus = (s: JobStatus) => s === 'completed' || s === 'failed' || s === 'cancelled';

class CancelledError extends Error {
  constructor() {
    super('İndirme iptal edildi');
    this.name = 'CancelledError';
  }
}

/**
 * İndirme işlerini (URL → metadata → kaynak → indirme → etiket) yönetir.
 * Tek şarkılar, seçilmiş şarkılar ve albüm / çalma listesi toplu işleri aynı kuyruğu
 * paylaşır; aynı anda en fazla MAX_CONCURRENT_DOWNLOADS iş çalışır, gerisi sırada bekler.
 */
export class JobsService {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly batches = new Map<string, BatchRecord>();
  private readonly events = new EventEmitter();
  private readonly queue = new PQueue({ concurrency: env.MAX_CONCURRENT_DOWNLOADS });
  private sweeper: NodeJS.Timeout | null = null;
  private store: JsonStore<StoredQueue> | null = null;
  private state: QueueState = { paused: false, reason: null, pausedAt: null };
  private consecutiveFailures = 0;

  constructor() {
    this.events.setMaxListeners(0);
  }

  // --- Kalıcılık -----------------------------------------------------------

  /**
   * Önceki oturumdan kalan işleri yükler: bitmemiş olanlar yeniden sıraya girer, başarısızlar
   * "yeniden dene" için listede kalır. Sunucu açılırken bir kez çağrılır.
   */
  restore(dataDir = resolve(env.DATA_DIR)): number {
    if (this.store) return 0;
    this.store = new JsonStore<StoredQueue>(join(dataDir, 'queue.json'), { jobs: [], batches: [] }, (raw) => {
      const r = raw as Partial<StoredQueue> | null;
      return r && Array.isArray(r.jobs) && Array.isArray(r.batches) ? { jobs: r.jobs, batches: r.batches } : null;
    });
    const saved = this.store.data;
    const ids = new Set(saved.jobs.map((j) => j.id));
    for (const b of saved.batches) {
      const jobIds = b.jobIds.filter((id) => ids.has(id));
      if (jobIds.length) this.batches.set(b.id, { ...b, jobIds });
    }
    let requeued = 0;
    for (const sj of saved.jobs) {
      if (sj.options.batchId && !this.batches.has(sj.options.batchId)) delete sj.options.batchId;
      if (sj.status === 'queued') {
        this.create(sj.url, sj.format, sj.options, { id: sj.id, createdAt: sj.createdAt });
        requeued++;
      } else {
        this.addFinished(sj);
      }
    }
    if (saved.jobs.length) logger.info({ requeued, total: saved.jobs.length }, 'Önceki oturumdan kalan indirmeler yüklendi');
    return requeued;
  }

  /** Bitmemiş ve başarısız işleri diske yazar (tamamlananlar kütüphanede / geçmişte zaten var) */
  private persist(): void {
    if (!this.store) return;
    const jobs: StoredJob[] = [];
    for (const j of this.jobs.values()) {
      if (j.status === 'completed') continue;
      jobs.push({
        id: j.id,
        url: j.url,
        format: j.format,
        options: j.options,
        status: j.status === 'failed' || j.status === 'cancelled' ? j.status : 'queued',
        error: j.error,
        metadata: j.metadata,
        createdAt: j.createdAt,
      });
    }
    const used = new Set(jobs.map((j) => j.options.batchId).filter(Boolean));
    const batches = [...this.batches.values()].filter((b) => used.has(b.id));
    this.store.set({ jobs, batches });
  }

  flush(): Promise<void> {
    return this.store?.flush() ?? Promise.resolve();
  }

  /**
   * Önceki oturumdan sahipsiz kalan indirme klasörlerini ve geçici dosyaları siler
   * (tamamlanan işler diske yazılmadığı için kapanışta klasörleri unutulurdu). restore() sonrası çağrılır.
   */
  async sweepOrphans(): Promise<number> {
    const removed = await downloaderService.sweepOrphans(new Set(this.jobs.keys()));
    if (removed) logger.info({ removed }, 'Önceki oturumdan kalan indirme artıkları temizlendi');
    return removed;
  }

  private addFinished(sj: StoredJob): void {
    const job: InternalJob = {
      id: sj.id,
      url: sj.url,
      format: sj.format,
      batchId: sj.options.batchId ?? null,
      status: sj.status,
      progress: 0,
      message: STAGE_MESSAGE[sj.status],
      platform: metadataService.detectPlatform(sj.url),
      metadata: sj.metadata,
      source: null,
      file: null,
      error: sj.error,
      timings: null,
      attempt: 0,
      createdAt: sj.createdAt,
      updatedAt: new Date().toISOString(),
      options: sj.options,
      filePath: null,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    this.jobs.set(job.id, job);
  }

  // --- Duraklatma ----------------------------------------------------------

  get queueState(): QueueState {
    return { ...this.state };
  }

  /** Duraklatılmış kuyruğu sürdürür; isteğe bağlı olarak başarısız işleri yeniden sıraya koyar */
  resume(options: { retryFailed?: boolean; codes?: string[] } = {}): number {
    let retried = 0;
    if (options.retryFailed) {
      for (const job of [...this.jobs.values()]) {
        if (job.status !== 'failed') continue;
        if (options.codes && !options.codes.includes(job.error?.code ?? '')) continue;
        if (this.retry(job.id)) retried++;
      }
    }
    this.consecutiveFailures = 0;
    if (this.state.paused) {
      this.state = { paused: false, reason: null, pausedAt: null };
      if (this.holds === 0) this.queue.start();
      this.events.emit('state', this.queueState);
      logger.info({ retried }, 'İndirme kuyruğu sürdürüldü');
    }
    return retried;
  }

  onState(listener: (state: QueueState) => void): () => void {
    this.events.on('state', listener);
    return () => this.events.off('state', listener);
  }

  /** Eski iş yeniden denenince yeni kimlik alır (liste senkronu gibi takip edenler için) */
  onReplaced(listener: (oldId: string, newId: string) => void): () => void {
    this.events.on('replaced', listener);
    return () => this.events.off('replaced', listener);
  }

  private holds = 0;

  /**
   * Bakım için yeni işlerin başlamasını geçici olarak durdurur (ör. yt-dlp klasörü değiştirilirken);
   * kullanıcıya "duraklatıldı" gösterilmez. Dönen fonksiyon bırakır.
   */
  hold(): () => void {
    this.holds++;
    this.queue.pause();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      if (this.holds === 0 && !this.state.paused) this.queue.start();
    };
  }

  /** Şu an çalışan (yeniden denemeyi bekleyenler dahil) iş sayısı */
  get running(): number {
    return this.queue.pending;
  }

  private pause(reason: string): void {
    if (this.state.paused) return;
    this.queue.pause();
    this.state = { paused: true, reason, pausedAt: new Date().toISOString() };
    this.events.emit('state', this.queueState);
    if (reason === 'USER') logger.info('İndirme kuyruğu kullanıcı tarafından duraklatıldı');
    else logger.warn({ reason }, 'Art arda başarısız indirmeler: kuyruk duraklatıldı');
  }

  // --- Tek işler -----------------------------------------------------------

  create(url: string, format: OutputFormat, options: JobOptions = {}, restored?: { id: string; createdAt: string }): PublicJob {
    const now = new Date().toISOString();
    const job: InternalJob = {
      id: restored?.id ?? randomUUID(),
      url,
      format,
      batchId: options.batchId ?? null,
      status: 'queued',
      progress: 0,
      message: STAGE_MESSAGE.queued,
      platform: metadataService.detectPlatform(url),
      metadata: null,
      source: null,
      file: null,
      error: null,
      timings: null,
      attempt: 0,
      createdAt: restored?.createdAt ?? now,
      updatedAt: now,
      options,
      filePath: null,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    this.jobs.set(job.id, job);
    job.done = this.queue.add(() => this.run(job), { throwOnTimeout: true });
    this.events.emit('any', this.toPublic(job));
    this.persist();
    return this.toPublic(job);
  }

  get(id: string): PublicJob | null {
    const job = this.jobs.get(id);
    return job ? this.toPublic(job) : null;
  }

  /** Tamamlanmış işin dosyası; hazır değilse null. */
  getFile(id: string): { path: string; name: string; mimeType: string } | null {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'completed' || !job.filePath || !job.file) return null;
    return { path: job.filePath, name: job.file.name, mimeType: job.file.mimeType };
  }

  /** İş bitene (başarılı, başarısız ya da iptal) kadar bekler. */
  async waitFor(id: string): Promise<PublicJob | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    await job.done;
    return this.toPublic(job);
  }

  /** İş güncellemelerine abone olur; aboneliği iptal eden fonksiyonu döndürür. */
  subscribe(id: string, listener: (job: PublicJob) => void): () => void {
    const event = `job:${id}`;
    this.events.on(event, listener);
    return () => this.events.off(event, listener);
  }

  /** Tüm işlerin güncellemeleri (sıra sayfası için). */
  subscribeAll(listener: (job: PublicJob, batch: PublicBatch | null) => void): () => void {
    const handler = (job: PublicJob) => {
      const batch = job.batchId ? this.batches.get(job.batchId) : undefined;
      listener(job, batch ? this.summarize(batch) : null);
    };
    this.events.on('any', handler);
    return () => this.events.off('any', handler);
  }

  isTerminal(job: PublicJob): boolean {
    return isTerminalStatus(job.status);
  }

  /** Sıradaki ya da çalışan işi iptal eder. Bitmiş işlerde false. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || isTerminalStatus(job.status)) return false;
    job.abort.abort();
    // Henüz başlamamış iş: hemen iptal göster (kuyruk sırası gelince run() atlar)
    if (job.status === 'queued') this.update(job, { status: 'cancelled', message: STAGE_MESSAGE.cancelled });
    return true;
  }

  /** Başarısız ya da iptal edilmiş işi aynı ayarlarla yeniden sıraya koyar. */
  retry(id: string): PublicJob | null {
    const old = this.jobs.get(id);
    if (!old || (old.status !== 'failed' && old.status !== 'cancelled')) return null;
    const job = this.create(old.url, old.format, old.options);
    // Toplu işte eski işin yerini alır
    if (old.batchId) {
      const batch = this.batches.get(old.batchId);
      if (batch) batch.jobIds = batch.jobIds.map((j) => (j === id ? job.id : j));
    }
    this.jobs.delete(id);
    this.events.emit('removed', id);
    this.events.emit('replaced', id, job.id);
    this.persist();
    return job;
  }

  /** Tamamlanan / başarısız / iptal edilmiş işleri sıradan kaldırır (geçmiş korunur). */
  async clearFinished(): Promise<number> {
    const finished = [...this.jobs.values()].filter((j) => isTerminalStatus(j.status));
    for (const job of finished) {
      this.jobs.delete(job.id);
      this.events.emit('removed', job.id);
      await downloaderService.remove(job.id).catch(() => undefined);
    }
    this.pruneBatches();
    this.persist();
    return finished.length;
  }

  onRemoved(listener: (id: string) => void): () => void {
    this.events.on('removed', listener);
    return () => this.events.off('removed', listener);
  }

  /** Sıra sayfası için tüm işler (en yenisi önce) ve toplu işler. */
  snapshot(): QueueSnapshot {
    const jobs = [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const stats = { active: 0, queued: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const j of jobs) {
      if (j.status === 'queued') stats.queued++;
      else if (j.status === 'completed') stats.completed++;
      else if (j.status === 'failed') stats.failed++;
      else if (j.status === 'cancelled') stats.cancelled++;
      else stats.active++;
    }
    return {
      jobs: jobs.map((j) => this.toPublic(j)),
      batches: [...this.batches.values()].map((b) => this.summarize(b)),
      stats,
      state: this.queueState,
    };
  }

  // --- Toplu işler (albüm / çalma listesi / seçilen şarkılar) -------------

  createBatch(input: { name: string; format: OutputFormat; items: BatchItem[]; useFolder?: boolean }): PublicBatch {
    const batch: BatchRecord = {
      id: randomUUID(),
      name: input.name,
      folder: input.useFolder === false ? null : folderName(input.name),
      format: input.format,
      jobIds: [],
      createdAt: new Date().toISOString(),
    };
    this.batches.set(batch.id, batch);
    for (const item of input.items) {
      const job = this.create(item.url, input.format, {
        overrides: item.overrides,
        extras: item.extras,
        batchId: batch.id,
      });
      batch.jobIds.push(job.id);
    }
    logger.info({ batchId: batch.id, name: batch.name, tracks: batch.jobIds.length }, 'Toplu indirme başladı');
    return this.summarize(batch);
  }

  getBatch(id: string): { batch: PublicBatch; jobs: PublicJob[] } | null {
    const batch = this.batches.get(id);
    if (!batch) return null;
    return { batch: this.summarize(batch), jobs: this.batchJobs(batch).map((j) => this.toPublic(j)) };
  }

  /** Toplu işteki parça güncellemelerine abone olur. */
  subscribeBatch(id: string, listener: (job: PublicJob, batch: PublicBatch) => void): () => void {
    const event = `batch:${id}`;
    const handler = (job: PublicJob) => {
      const batch = this.batches.get(id);
      if (batch) listener(job, this.summarize(batch));
    };
    this.events.on(event, handler);
    return () => this.events.off(event, handler);
  }

  /** ZIP için tamamlanmış dosyalar. */
  batchFiles(id: string): Array<{ path: string; name: string }> {
    const batch = this.batches.get(id);
    if (!batch) return [];
    return this.batchJobs(batch)
      .filter((j) => j.status === 'completed' && j.filePath && j.file)
      .map((j) => ({ path: j.filePath!, name: j.file!.name }));
  }

  /** Toplu işin bitmemiş tüm parçalarını iptal eder; iptal edilen sayıyı döndürür. Toplu iş yoksa null. */
  cancelBatch(id: string): number | null {
    const batch = this.batches.get(id);
    if (!batch) return null;
    let cancelled = 0;
    for (const job of this.batchJobs(batch)) if (this.cancel(job.id)) cancelled++;
    return cancelled;
  }

  /** Toplu işin başarısız ya da iptal edilmiş parçalarını yeniden sıraya koyar. Toplu iş yoksa null. */
  retryBatch(id: string): number | null {
    const batch = this.batches.get(id);
    if (!batch) return null;
    let retried = 0;
    for (const job of this.batchJobs(batch)) {
      if ((job.status === 'failed' || job.status === 'cancelled') && this.retry(job.id)) retried++;
    }
    return retried;
  }

  /** Kullanıcı kuyruğu elle duraklatır: çalışanlar biter, sıradakiler "Sürdür"e kadar bekler */
  pauseByUser(): QueueState {
    this.pause('USER');
    return this.queueState;
  }

  isBatchTerminal(batch: PublicBatch): boolean {
    return batch.status !== 'running';
  }

  // --- Temizlik ------------------------------------------------------------

  /** FILE_RETENTION_MINUTES'tan eski işleri ve dosyalarını periyodik olarak siler. */
  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  async sweep(now = Date.now()): Promise<number> {
    const maxAge = env.FILE_RETENTION_MINUTES * 60_000;
    const old = (job: InternalJob) => isTerminalStatus(job.status) && now - Date.parse(job.updatedAt) >= maxAge;
    // Toplu işin parçaları ancak hepsi bitip eskiyince birlikte silinir; yoksa yarım kalan
    // bir albümün ilerlemesi geriye gider ve "bitti" durumuna hiç ulaşamaz.
    const batchDone = new Map<string, boolean>();
    const batchSweepable = (id: string) => {
      let done = batchDone.get(id);
      if (done === undefined) {
        const batch = this.batches.get(id);
        done = !batch || batch.jobIds.every((jid) => {
          const j = this.jobs.get(jid);
          return !j || j.status === 'failed' || old(j);
        });
        batchDone.set(id, done);
      }
      return done;
    };
    let removed = 0;
    for (const job of this.jobs.values()) {
      // Başarısız işler yeniden denenebilsin diye bir hafta kalır (dosyaları yoktur)
      if (job.status === 'failed' ? now - Date.parse(job.updatedAt) < FAILED_RETENTION_MS : !old(job)) continue;
      if (job.batchId && !batchSweepable(job.batchId)) continue;
      this.jobs.delete(job.id);
      this.events.emit('removed', job.id);
      await downloaderService.remove(job.id).catch((err) => logger.warn({ err, id: job.id }, 'Dosya silinemedi'));
      removed++;
    }
    this.pruneBatches();
    if (removed > 0) {
      logger.info({ removed }, 'Süresi dolan indirmeler temizlendi');
      this.persist();
    }
    return removed;
  }

  // -------------------------------------------------------------------------

  private pruneBatches(): void {
    for (const batch of this.batches.values()) {
      if (!batch.jobIds.some((id) => this.jobs.has(id))) this.batches.delete(batch.id);
    }
  }

  private batchJobs(batch: BatchRecord): InternalJob[] {
    return batch.jobIds.map((id) => this.jobs.get(id)).filter((j): j is InternalJob => Boolean(j));
  }

  private summarize(batch: BatchRecord): PublicBatch {
    const jobs = this.batchJobs(batch);
    const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
    const completed = count('completed');
    const failed = count('failed');
    const cancelled = count('cancelled');
    const total = batch.jobIds.length;
    const running = completed + failed + cancelled < total;
    return {
      id: batch.id,
      name: batch.name,
      folder: batch.folder,
      format: batch.format,
      total,
      completed,
      failed,
      cancelled,
      progress: total ? Math.round(jobs.reduce((sum, j) => sum + (isTerminalStatus(j.status) ? 100 : j.progress), 0) / total) : 0,
      status: running ? 'running' : failed + cancelled === 0 ? 'completed' : completed === 0 ? 'failed' : 'partial',
      createdAt: batch.createdAt,
      jobIds: [...batch.jobIds],
    };
  }

  private async run(job: InternalJob): Promise<void> {
    const signal = job.abort.signal;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) return; // sırada beklerken iptal edildi
      job.attempt = attempt;
      const outcome = await this.attemptOnce(job);
      if (outcome === 'done') {
        this.consecutiveFailures = 0;
        return;
      }
      if (outcome === 'cancelled') return;

      const code = job.error?.code ?? 'ERROR';
      if (suggestsYtDlpUpdate(code)) downloadHealth.emit('outdated', code);
      if (!isTransientFailure(code) || attempt === MAX_ATTEMPTS) break;

      // Geçici hata: bekleyip yeniden dene (sıra kaybedilmez)
      const wait = BACKOFF_MS[attempt - 1] ?? 30_000;
      this.update(job, {
        status: 'queued',
        error: null,
        message: `Yeniden denenecek (${attempt + 1}/${MAX_ATTEMPTS})`,
        attempt,
      });
      await sleep(wait, signal);
    }
    if (job.status !== 'failed') return;
    const code = job.error?.code ?? 'ERROR';
    if (isTransientFailure(code)) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= PAUSE_AFTER_FAILURES) this.pause(code);
    }
  }

  /** Tek deneme. Sonuç: tamam / iptal / başarısız (hata job.error'da) */
  private async attemptOnce(job: InternalJob): Promise<'done' | 'cancelled' | 'failed'> {
    const signal = job.abort.signal;
    const started = Date.now();
    const marks: number[] = [];
    const checkCancelled = () => {
      if (signal.aborted) throw new CancelledError();
    };
    try {
      this.update(job, { status: 'resolving', progress: 2, message: 'Metadata alınıyor' });
      const extraction = await metadataService.extractDetailed(job.url);
      checkCancelled();
      marks.push(Date.now());
      const metadata = applyOverrides(extraction.metadata, job.options.overrides);
      this.update(job, { platform: extraction.platform, metadata, progress: 6, message: STAGE_MESSAGE.resolving });

      // Tür, ses kaynağı eşleştirilirken paralel bulunur (Deezer'ın "Pop" varsayılanına güvenilmez)
      const genrePromise = genreService
        .resolve({ title: metadata.title, artist: metadata.artist, album: metadata.album, hint: metadata.genre })
        .catch(() => null);
      const source = await resolverService.resolve(metadata);
      const genre = await genrePromise;
      if (genre?.genre) metadata.genre = genre.genre;
      checkCancelled();
      marks.push(Date.now());
      this.update(job, { source: toPublicSource(source), progress: STAGE_RANGE.resolving[1] });

      const file: DownloadedFile = await downloaderService.download({
        id: job.id,
        metadata,
        source,
        format: job.format,
        extras: job.options.extras,
        signal,
        onProgress: ({ stage, percent }) => {
          const [from, to] = STAGE_RANGE[stage];
          const progress = Math.round(from + ((to - from) * percent) / 100);
          // Aynı değeri tekrar tekrar yayınlamamak için
          if (job.status === stage && job.progress === progress) return;
          this.update(job, { status: stage, progress, message: STAGE_MESSAGE[stage] });
        },
      });
      checkCancelled();

      const finished = Date.now();
      const timings: JobTimings = {
        waited: started - Date.parse(job.createdAt),
        metadata: marks[0]! - started,
        resolve: marks[1]! - marks[0]!,
        download: finished - marks[1]!,
        total: finished - Date.parse(job.createdAt),
      };
      job.filePath = file.path;
      this.update(job, {
        status: 'completed',
        progress: 100,
        message: STAGE_MESSAGE.completed,
        file: { name: file.fileName, size: file.size, mimeType: file.mimeType, hasCover: file.hasCover, lyrics: file.lyrics },
        timings,
      });
      historyService.add({
        id: job.id,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        coverUrl: metadata.coverUrl,
        format: job.format,
        fileName: file.fileName,
        size: file.size,
        platform: extraction.platform,
        sourceUrl: job.url,
        collection: job.batchId ? this.batches.get(job.batchId)?.name ?? null : null,
        durationMs: timings.total,
        completedAt: new Date(finished).toISOString(),
      });
      void libraryService.recordDownload(job.id, metadata, file, {
        folder: job.batchId ? this.batches.get(job.batchId)?.folder ?? null : null,
        trackNumber: job.options.extras?.trackNumber ?? null,
        source: { videoId: source.videoId, score: source.match.score, strategy: source.match.strategy },
      });
      logger.info({ id: job.id, file: file.fileName, size: file.size, timings }, 'İndirme tamamlandı');
      return 'done';
    } catch (err) {
      if (signal.aborted) {
        await downloaderService.remove(job.id).catch(() => undefined);
        this.update(job, { status: 'cancelled', message: STAGE_MESSAGE.cancelled, progress: job.progress });
        return 'cancelled';
      }
      const error = errorInfo(err);
      logger.warn({ err, id: job.id, url: job.url, code: error.code, attempt: job.attempt }, 'İndirme başarısız');
      this.update(job, { status: 'failed', message: STAGE_MESSAGE.failed, error });
      return 'failed';
    }
  }

  private update(job: InternalJob, patch: Partial<PublicJob>): void {
    const statusChanged = patch.status !== undefined && patch.status !== job.status;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    if (statusChanged) this.persist();
    const snapshot = this.toPublic(job);
    this.events.emit(`job:${job.id}`, snapshot);
    if (job.batchId) this.events.emit(`batch:${job.batchId}`, snapshot);
    this.events.emit('any', snapshot);
  }

  private toPublic(job: InternalJob): PublicJob {
    const { filePath: _filePath, done: _done, options: _options, abort: _abort, ...pub } = job;
    return { ...pub };
  }
}

export const jobsService = new JobsService();
