import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/json-store.js';
import { logger } from '../utils/logger.js';
import type { OutputFormat } from './downloader.service.js';
import { jobsService } from './jobs.service.js';
import { libraryService } from './library.service.js';
import { metadataService } from './metadata.service.js';
import { playlistService } from './playlist.service.js';

/**
 * Liste senkronu: takibe alınan bir çalma listesi (Spotify, Apple Music, Deezer, YouTube Music)
 * düzenli olarak kontrol edilir; yalnızca yeni eklenen şarkılar indirilir ve aynı adlı FlacSync
 * çalma listesine eklenir. Kütüphanede zaten olan şarkılar yeniden indirilmez.
 */

export interface WatchedPlaylist {
  id: string;
  url: string;
  name: string;
  platform: string;
  coverUrl: string | null;
  /** Şarkıların eklendiği FlacSync çalma listesi */
  playlistId: string;
  format: OutputFormat;
  enabled: boolean;
  /** Kütüphaneye girmiş (ya da zaten olan) kaynak şarkı linkleri */
  known: string[];
  /**
   * İndirilmekte olanlar. Şarkı kütüphaneye girince "known"a geçer; indirme başarısız olursa
   * bir sonraki kontrolde yeniden denenir (eskiden sıraya girer girmez "bilinen" sayılıyordu).
   */
  pending?: Array<{ url: string; jobId: string }>;
  /** Kaynak link → başarısız indirme sayısı */
  failures?: Record<string, number>;
  trackCount: number;
  lastCheckedAt: string | null;
  lastAdded: number;
  lastError: string | null;
  addedAt: string;
}

export type PublicWatched = Omit<WatchedPlaylist, 'known' | 'pending' | 'failures'> & { checking: boolean; pendingCount: number };

const CHECK_INTERVAL_MS = 30 * 60_000;
const MAX_WATCHED = 50;
const MAX_TRACK_ATTEMPTS = 3;

function isWatched(v: unknown): v is WatchedPlaylist {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  return typeof w.id === 'string' && typeof w.url === 'string' && Array.isArray(w.known);
}

export class SyncError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NOT_A_PLAYLIST' | 'LIMIT',
    message: string,
  ) {
    super(message);
  }
}

export class SyncService {
  private readonly store: JsonStore<WatchedPlaylist[]>;
  private readonly checking = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(dataDir = resolve(env.DATA_DIR)) {
    this.store = new JsonStore<WatchedPlaylist[]>(join(dataDir, 'sync.json'), [], (raw) =>
      Array.isArray(raw) ? raw.filter(isWatched) : null,
    );
    // İndirilen şarkı kütüphaneye girince: listeye ekle, artık "bilinen" say
    libraryService.onAdded((jobId, trackId) => {
      for (const w of this.store.data) {
        const p = w.pending?.find((x) => x.jobId === jobId);
        if (!p) continue;
        w.pending = w.pending!.filter((x) => x !== p);
        if (!w.known.includes(p.url)) w.known.push(p.url);
        try {
          playlistService.add(this.ensurePlaylist(w), [trackId]);
        } catch (err) {
          logger.debug({ err }, 'Senkron: şarkı listeye eklenemedi');
        }
        this.store.touch();
        return;
      }
    });
    // "Yeniden dene" işe yeni kimlik verir: bekleyen kayıt yeni işe bağlanır
    jobsService.onReplaced((oldId, newId) => {
      for (const w of this.store.data) {
        const p = w.pending?.find((x) => x.jobId === oldId);
        if (p) {
          p.jobId = newId;
          this.store.touch();
        }
      }
    });
  }

  /** Arka plan kontrolünü başlatır (sunucu açılışında) */
  start(): void {
    if (this.timer) return;
    setTimeout(() => void this.checkAll(), 60_000).unref();
    this.timer = setInterval(() => void this.checkAll(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  list(): PublicWatched[] {
    return this.store.data.map((w) => this.public(w));
  }

  /**
   * Listeyi takibe alır. `downloadExisting`: listede şu an olan şarkılar da indirilsin mi
   * (hayır ise yalnızca bundan sonra eklenenler).
   */
  async add(url: string, format: OutputFormat, downloadExisting: boolean): Promise<PublicWatched> {
    if (this.store.data.length >= MAX_WATCHED) throw new SyncError('LIMIT', 'En fazla 50 liste takip edilebilir');
    const existing = this.store.data.find((w) => w.url === url);
    if (existing) return this.public(existing);

    const lookup = await metadataService.lookup(url);
    if (lookup.kind !== 'collection') throw new SyncError('NOT_A_PLAYLIST', 'Bu bir çalma listesi ya da albüm linki değil');
    const c = lookup.collection;
    const playlist = playlistService.create(c.title);
    const w: WatchedPlaylist = {
      id: randomUUID(),
      url,
      name: c.title,
      platform: c.platform,
      coverUrl: c.coverUrl,
      playlistId: playlist.id,
      format,
      enabled: true,
      known: downloadExisting ? [] : c.tracks.map((t) => t.url),
      trackCount: c.tracks.length,
      lastCheckedAt: downloadExisting ? null : new Date().toISOString(),
      lastAdded: 0,
      lastError: null,
      addedAt: new Date().toISOString(),
    };
    this.store.set([...this.store.data, w]);
    if (downloadExisting) void this.check(w.id);
    return this.public(w);
  }

  update(id: string, patch: { enabled?: boolean; format?: OutputFormat }): PublicWatched {
    const w = this.require(id);
    if (patch.enabled !== undefined) w.enabled = patch.enabled;
    if (patch.format) w.format = patch.format;
    this.store.touch();
    return this.public(w);
  }

  remove(id: string): boolean {
    const before = this.store.data.length;
    this.store.set(this.store.data.filter((w) => w.id !== id));
    return this.store.data.length < before;
  }

  async checkAll(): Promise<void> {
    for (const w of this.store.data) if (w.enabled) await this.check(w.id).catch(() => undefined);
  }

  /** Listeyi kontrol eder; yeni şarkıları indirir, kütüphanede olanları doğrudan listeye ekler */
  async check(id: string): Promise<PublicWatched> {
    const w = this.require(id);
    if (this.checking.has(id)) return this.public(w);
    this.checking.add(id);
    try {
      const lookup = await metadataService.lookup(w.url);
      if (lookup.kind !== 'collection') throw new SyncError('NOT_A_PLAYLIST', 'Liste artık açılamıyor');
      const c = lookup.collection;
      const known = new Set(w.known);
      // Hâlâ sırada / inmekte olanlar atlanır; başarısız ya da kaybolmuş işler yeniden indirilir
      const failures = (w.failures ??= {});
      const stillPending = (w.pending ?? []).filter((p) => {
        const job = jobsService.get(p.jobId);
        // Kullanıcı iptal ettiyse istemiyor demektir: bir daha indirilmez
        if (job?.status === 'cancelled') {
          known.add(p.url);
          return false;
        }
        const active = job !== null && job.status !== 'failed';
        if (!active) {
          // Hiç bulunamayan şarkı her kontrolde sonsuza dek denenmesin: 3 denemeden sonra bırakılır
          failures[p.url] = (failures[p.url] ?? 0) + 1;
          if (failures[p.url]! >= MAX_TRACK_ATTEMPTS) known.add(p.url);
        }
        return active;
      });
      const pendingUrls = new Set(stillPending.map((p) => p.url));
      const fresh = c.tracks.filter((t) => !known.has(t.url) && !pendingUrls.has(t.url));

      // Kütüphanede zaten olanlar: indirme yok, listeye eklenir

      const inLibrary: string[] = [];
      const alreadyHave: string[] = [];
      const toDownload = fresh.filter((t) => {
        const hit = libraryService.find(t.artist, t.title, t.duration);
        if (hit) {
          inLibrary.push(hit);
          alreadyHave.push(t.url);
        }
        return !hit;
      });
      // Kullanıcı bağlı FlacSync listesini silmiş olabilir: yeniden oluşturulur (senkron kırılmasın)
      const playlistId = this.ensurePlaylist(w);
      if (inLibrary.length) playlistService.add(playlistId, inLibrary);
      const newPending = [...stillPending];
      if (toDownload.length) {
        const batch = jobsService.createBatch({
          name: w.name,
          format: w.format,
          items: toDownload.map((t) => ({ url: t.url })),
          useFolder: true,
        });
        // Toplu işteki iş sırası, verilen şarkı sırasıyla aynıdır
        batch.jobIds.forEach((jobId, i) => newPending.push({ url: toDownload[i]!.url, jobId }));
      }

      w.known = [...new Set([...known, ...alreadyHave])];
      w.pending = newPending;
      w.name = c.title;
      w.coverUrl = c.coverUrl ?? w.coverUrl;
      w.trackCount = c.tracks.length;
      w.lastAdded = fresh.length;
      w.lastError = null;
      if (fresh.length) logger.info({ playlist: w.name, added: fresh.length }, 'Liste senkronu: yeni şarkılar');
    } catch (err) {
      w.lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err, url: w.url }, 'Liste senkronu başarısız');
    } finally {
      w.lastCheckedAt = new Date().toISOString();
      this.checking.delete(id);
      this.store.touch();
    }
    return this.public(w);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  /** Bağlı çalma listesi silindiyse aynı adla yeniden oluşturur; geçerli liste kimliğini döndürür */
  private ensurePlaylist(w: WatchedPlaylist): string {
    if (playlistService.get(w.playlistId)) return w.playlistId;
    const created = playlistService.create(w.name);
    logger.info({ playlist: w.name }, 'Liste senkronu: silinen çalma listesi yeniden oluşturuldu');
    w.playlistId = created.id;
    this.store.touch();
    return created.id;
  }

  private find(id: string): WatchedPlaylist | undefined {
    return this.store.data.find((w) => w.id === id);
  }

  private require(id: string): WatchedPlaylist {
    const w = this.find(id);
    if (!w) throw new SyncError('NOT_FOUND', 'Takip edilen liste bulunamadı');
    return w;
  }

  private public(w: WatchedPlaylist): PublicWatched {
    const { known: _k, pending, failures: _f, ...rest } = w;
    return { ...rest, checking: this.checking.has(w.id), pendingCount: pending?.length ?? 0 };
  }
}

export const syncService = new SyncService();
