import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import PQueue from 'p-queue';
import sanitizeFilename from 'sanitize-filename';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { downloaderService, type DownloadedFile, type OutputFormat, type TagExtras } from './downloader.service.js';
import { historyService } from './history.service.js';
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
  file: { name: string; size: number; mimeType: string; hasCover: boolean } | null;
  error: { code: string; message: string; status: number } | null;
  /** Aşama süreleri (ms) — tamamlanınca dolar */
  timings: JobTimings | null;
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

export interface QueueSnapshot {
  jobs: PublicJob[];
  batches: PublicBatch[];
  stats: { active: number; queued: number; completed: number; failed: number; cancelled: number };
}

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

function errorInfo(err: unknown): { code: string; message: string; status: number } {
  const e = err as { code?: unknown; name?: string; message?: string; statusCode?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code : e.name ?? 'ERROR',
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

  constructor() {
    this.events.setMaxListeners(0);
  }

  // --- Tek işler -----------------------------------------------------------

  create(url: string, format: OutputFormat, options: JobOptions = {}): PublicJob {
    const now = new Date().toISOString();
    const job: InternalJob = {
      id: randomUUID(),
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
      createdAt: now,
      updatedAt: now,
      options,
      filePath: null,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    this.jobs.set(job.id, job);
    job.done = this.queue.add(() => this.run(job), { throwOnTimeout: true });
    this.events.emit('any', this.toPublic(job));
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
    let removed = 0;
    for (const job of this.jobs.values()) {
      if (!isTerminalStatus(job.status) || now - Date.parse(job.updatedAt) < maxAge) continue;
      this.jobs.delete(job.id);
      this.events.emit('removed', job.id);
      await downloaderService.remove(job.id).catch((err) => logger.warn({ err, id: job.id }, 'Dosya silinemedi'));
      removed++;
    }
    this.pruneBatches();
    if (removed > 0) logger.info({ removed }, 'Süresi dolan indirmeler temizlendi');
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
    if (signal.aborted) return; // sırada beklerken iptal edildi
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

      const source = await resolverService.resolve(metadata);
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
        file: { name: file.fileName, size: file.size, mimeType: file.mimeType, hasCover: file.hasCover },
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
      logger.info({ id: job.id, file: file.fileName, size: file.size, timings }, 'İndirme tamamlandı');
    } catch (err) {
      if (signal.aborted) {
        await downloaderService.remove(job.id).catch(() => undefined);
        this.update(job, { status: 'cancelled', message: STAGE_MESSAGE.cancelled, progress: job.progress });
        return;
      }
      logger.warn({ err, id: job.id, url: job.url }, 'İndirme başarısız');
      this.update(job, { status: 'failed', message: STAGE_MESSAGE.failed, error: errorInfo(err) });
    }
  }

  private update(job: InternalJob, patch: Partial<PublicJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
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
