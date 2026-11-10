import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/json-store.js';
import { logger } from '../utils/logger.js';
import type { OutputFormat } from './downloader.service.js';
import { jobsService } from './jobs.service.js';
import { libraryService } from './library.service.js';
import { stripTitleNoise, splitArtists } from './matcher/similarity.js';
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
  /** Daha önce görülen kaynak şarkı linkleri */
  known: string[];
  trackCount: number;
  lastCheckedAt: string | null;
  lastAdded: number;
  lastError: string | null;
  addedAt: string;
}

export type PublicWatched = Omit<WatchedPlaylist, 'known'> & { checking: boolean };

const CHECK_INTERVAL_MS = 30 * 60_000;
const MAX_WATCHED = 50;

const norm = (s: string) =>
  s
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const songKey = (artist: string, title: string) => `${norm(splitArtists(artist)[0] ?? artist)}|${norm(stripTitleNoise(title))}`;

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
  /** İndirme işi → senkron kaydı (iş bitip kütüphaneye girince listeye eklenir) */
  private readonly pendingJobs = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(dataDir = resolve(env.DATA_DIR)) {
    this.store = new JsonStore<WatchedPlaylist[]>(join(dataDir, 'sync.json'), [], (raw) =>
      Array.isArray(raw) ? raw.filter(isWatched) : null,
    );
    libraryService.onAdded((jobId, trackId) => {
      const watchId = this.pendingJobs.get(jobId);
      if (!watchId) return;
      this.pendingJobs.delete(jobId);
      const w = this.find(watchId);
      if (w) {
        try {
          playlistService.add(w.playlistId, [trackId]);
        } catch (err) {
          logger.debug({ err }, 'Senkron: şarkı listeye eklenemedi');
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
    return this.store.data.map(({ known: _k, ...w }) => ({ ...w, checking: this.checking.has(w.id) }));
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
      const fresh = c.tracks.filter((t) => !known.has(t.url));

      // Kütüphanede zaten olanlar: indirme yok, listeye eklenir
      const library = new Map(libraryService.entries().map((t) => [songKey(t.artist, t.title), t.id]));
      const inLibrary: string[] = [];
      const toDownload = fresh.filter((t) => {
        const hit = library.get(songKey(t.artist, t.title));
        if (hit) inLibrary.push(hit);
        return !hit;
      });
      if (inLibrary.length) playlistService.add(w.playlistId, inLibrary);
      if (toDownload.length) {
        const batch = jobsService.createBatch({
          name: w.name,
          format: w.format,
          items: toDownload.map((t) => ({ url: t.url })),
          useFolder: true,
        });
        for (const jobId of batch.jobIds) this.pendingJobs.set(jobId, w.id);
      }

      w.known = [...known, ...fresh.map((t) => t.url)];
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

  private find(id: string): WatchedPlaylist | undefined {
    return this.store.data.find((w) => w.id === id);
  }

  private require(id: string): WatchedPlaylist {
    const w = this.find(id);
    if (!w) throw new SyncError('NOT_FOUND', 'Takip edilen liste bulunamadı');
    return w;
  }

  private public(w: WatchedPlaylist): PublicWatched {
    const { known: _k, ...rest } = w;
    return { ...rest, checking: this.checking.has(w.id) };
  }
}

export const syncService = new SyncService();
