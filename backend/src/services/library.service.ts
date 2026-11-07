import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { copyFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, parse, relative, resolve } from 'node:path';
import { env } from '../config/env.js';
import PQueue from 'p-queue';
import { readTags } from '../utils/audio-tags.js';
import { ffmpegPath } from '../utils/ffmpeg.js';
import { logger } from '../utils/logger.js';
import type { TrackMetadata } from './metadata/types.js';

/**
 * Kütüphane: indirilen şarkılar. Uygulamadan dinlenebilir, türe / albüme göre gezilebilir.
 *
 * - Sunucu / web: tamamlanan dosya LIBRARY_DIR'e kopyalanır (LIBRARY_COPY=true).
 * - Masaüstü: dosyalar zaten İndirilenler\FlacSync'e kaydediliyor; kayıt bitince
 *   masaüstü süreci `attach(jobId, yol)` çağırır, kopya oluşmaz (LIBRARY_COPY=false).
 * - "Yeniden tara" klasördeki elle eklenmiş / eski dosyaları etiketlerinden okuyarak ekler.
 */

export interface LibraryTrack {
  /** Dosya yolundan türetilen sabit kimlik */
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  year: string | null;
  trackNumber: number | null;
  /** saniye */
  duration: number | null;
  format: 'mp3' | 'flac';
  size: number;
  /** İndirme sırasında bilinen uzak kapak; yoksa gömülü kapak /cover ile okunur */
  coverUrl: string | null;
  addedAt: string;
  /** Kütüphane klasörüne göre yol (arayüzde gösterilir) */
  relativePath: string;
}

interface StoredTrack extends LibraryTrack {
  path: string;
  mtimeMs: number;
}

export interface LibraryListing {
  tracks: LibraryTrack[];
  genres: { name: string; count: number }[];
  totalBytes: number;
  dir: string;
}

interface PendingMeta {
  metadata: TrackMetadata;
  trackNumber: number | null;
  at: number;
}

const AUDIO_EXT = new Set(['.mp3', '.flac']);
const MAX_SCAN_DEPTH = 4;
const MAX_TRACKS = 20_000;
const WRITE_DELAY_MS = 800;
const PENDING_TTL_MS = 6 * 60 * 60_000;

const trackId = (path: string) => createHash('sha1').update(resolve(path).toLowerCase()).digest('hex').slice(0, 16);

/** Gömülü kapağı JPEG olarak çıkarır; yoksa false. */
function extractCover(file: string, out: string): Promise<boolean> {
  return new Promise((done) => {
    if (!ffmpegPath) return done(false);
    const proc = spawn(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', '-i', file, '-an', '-frames:v', '1', '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', out],
      { windowsHide: true, stdio: 'ignore' },
    );
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
    proc.on('error', () => done(false));
    proc.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0 && existsSync(out));
    });
  });
}

const first = (tags: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (tags[k]) return tags[k];
  return null;
};

export class LibraryService {
  readonly dir: string;
  private readonly file: string;
  private readonly coverDir: string;
  private tracks = new Map<string, StoredTrack>();
  private readonly pending = new Map<string, PendingMeta>();
  private writeTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private scanning: Promise<{ added: number; removed: number }> | null = null;
  private readonly coverQueue = new PQueue({ concurrency: 3 });

  constructor(
    dir = resolve(env.LIBRARY_DIR),
    dataDir = resolve(env.DATA_DIR),
    private readonly copyCompleted = env.LIBRARY_COPY,
  ) {
    this.dir = dir;
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'library.json');
    this.coverDir = join(dataDir, 'covers');
    this.load();
  }

  list(): LibraryListing {
    const tracks = [...this.tracks.values()]
      .filter((t) => existsSync(t.path))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    const genreCount = new Map<string, number>();
    let totalBytes = 0;
    for (const t of tracks) {
      totalBytes += t.size;
      if (t.genre) genreCount.set(t.genre, (genreCount.get(t.genre) ?? 0) + 1);
    }
    return {
      tracks: tracks.map(({ path: _p, mtimeMs: _m, ...pub }) => pub),
      genres: [...genreCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      totalBytes,
      dir: this.dir,
    };
  }

  /** Akış / kapak için gerçek yol — yalnızca dizindeki kayıtlar (keyfi dosya okunamaz). */
  filePath(id: string): string | null {
    const t = this.tracks.get(id);
    return t && existsSync(t.path) ? t.path : null;
  }

  async coverPath(id: string): Promise<string | null> {
    const file = this.filePath(id);
    if (!file) return null;
    const out = join(this.coverDir, `${id}.jpg`);
    if (existsSync(out)) return out;
    mkdirSync(this.coverDir, { recursive: true });
    // Kütüphane açılınca onlarca kapak birden istenir; aynı anda en çok birkaç ffmpeg çalışır
    return (await this.coverQueue.add(async () => (existsSync(out) || (await extractCover(file, out)) ? out : null))) ?? null;
  }

  /** Kaydın genel bilgileri (yol hariç) */
  track(id: string): LibraryTrack | null {
    const t = this.tracks.get(id);
    if (!t) return null;
    const { path: _p, mtimeMs: _m, ...pub } = t;
    return pub;
  }

  /** Dosya dışarıdan değişti (ör. sözler gömüldü): boyut / tarih güncellenir */
  async touch(id: string): Promise<void> {
    const t = this.tracks.get(id);
    if (!t) return;
    const s = await stat(t.path).catch(() => null);
    if (!s) return;
    t.size = s.size;
    t.mtimeMs = s.mtimeMs;
    this.scheduleWrite();
  }

  coverUrl(id: string): string | null {
    return this.tracks.get(id)?.coverUrl ?? null;
  }

  /**
   * İndirme tamamlandı. Kopyalama açıksa dosya kütüphane klasörüne alınır;
   * değilse metadata, masaüstünün `attach` çağrısına kadar bekletilir.
   */
  async recordDownload(
    jobId: string,
    metadata: TrackMetadata,
    file: { path: string; fileName: string },
    options: { folder?: string | null; trackNumber?: number | null } = {},
  ): Promise<void> {
    const pending: PendingMeta = { metadata, trackNumber: options.trackNumber ?? null, at: Date.now() };
    if (!this.copyCompleted) {
      this.prunePending();
      this.pending.set(jobId, pending);
      return;
    }
    try {
      const dir = options.folder ? join(this.dir, options.folder) : this.dir;
      mkdirSync(dir, { recursive: true });
      const target = uniquePath(dir, file.fileName);
      await copyFile(file.path, target);
      await this.addFile(target, pending);
    } catch (err) {
      logger.warn({ err, jobId }, 'Şarkı kütüphaneye eklenemedi');
    }
  }

  /** Masaüstü: kaydedilen dosyanın yerini bildirir. */
  async attach(jobId: string, path: string): Promise<void> {
    const pending = this.pending.get(jobId);
    this.pending.delete(jobId);
    try {
      await this.addFile(path, pending);
    } catch (err) {
      logger.warn({ err, jobId, path }, 'Kaydedilen dosya kütüphaneye eklenemedi');
    }
  }

  remove(id: string): boolean {
    const removed = this.tracks.delete(id);
    if (removed) this.scheduleWrite();
    return removed;
  }

  /** Klasörü tarar: yeni dosyaları ekler, silinmiş olanları çıkarır. */
  rescan(): Promise<{ added: number; removed: number }> {
    this.scanning ??= this.doRescan().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      this.writing = this.writing.then(() => this.write());
    }
    await this.writing;
  }

  // -------------------------------------------------------------------------

  private async doRescan(): Promise<{ added: number; removed: number }> {
    let removed = 0;
    for (const [id, t] of this.tracks) {
      if (!existsSync(t.path)) {
        this.tracks.delete(id);
        removed++;
      }
    }
    const files: string[] = [];
    await walk(this.dir, 0, files);
    let added = 0;
    for (const file of files) {
      if (this.tracks.size >= MAX_TRACKS) break;
      const id = trackId(file);
      const existing = this.tracks.get(id);
      if (existing) {
        const s = await stat(file).catch(() => null);
        if (s && s.mtimeMs === existing.mtimeMs) continue;
      }
      try {
        await this.addFile(file, undefined, existing?.addedAt);
        if (!existing) added++;
      } catch (err) {
        logger.debug({ err, file }, 'Dosya okunamadı');
      }
    }
    if (added || removed) this.scheduleWrite();
    return { added, removed };
  }

  private async addFile(path: string, pending?: PendingMeta, addedAt?: string): Promise<void> {
    const ext = extname(path).toLowerCase();
    if (!AUDIO_EXT.has(ext)) return;
    const s = await stat(path);
    const meta = pending?.metadata;
    // İndirmeden gelen metadata yeterli; yalnızca bilinmeyen dosyalar ffmpeg ile okunur
    const read = meta ? null : await readTags(path);
    const tags = read?.tags ?? {};
    const trackRaw = first(tags, 'track', 'tracknumber');
    const id = trackId(path);

    const track: StoredTrack = {
      id,
      path: resolve(path),
      mtimeMs: s.mtimeMs,
      title: meta?.title ?? first(tags, 'title') ?? parse(path).name,
      artist: meta?.artist ?? first(tags, 'artist', 'album_artist', 'albumartist') ?? '',
      album: meta?.album ?? first(tags, 'album'),
      genre: meta?.genre ?? first(tags, 'genre'),
      year: meta?.releaseDate ?? first(tags, 'date', 'year')?.slice(0, 4) ?? null,
      trackNumber: pending?.trackNumber ?? (trackRaw ? Number.parseInt(trackRaw, 10) || null : null),
      duration: meta?.duration ?? read?.duration ?? null,
      format: ext === '.flac' ? 'flac' : 'mp3',
      size: s.size,
      coverUrl: meta?.coverUrl ?? null,
      addedAt: addedAt ?? this.tracks.get(id)?.addedAt ?? new Date().toISOString(),
      relativePath: relativeTo(this.dir, path),
    };
    this.tracks.set(id, track);
    this.scheduleWrite();
  }

  private prunePending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) if (p.at < cutoff) this.pending.delete(id);
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { tracks?: StoredTrack[] };
      for (const t of data.tracks ?? []) if (t?.id && t.path) this.tracks.set(t.id, t);
    } catch (err) {
      logger.warn({ err, file: this.file }, 'Kütüphane dizini okunamadı, boş başlatılıyor');
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writing = this.writing.then(() => this.write());
    }, WRITE_DELAY_MS);
    this.writeTimer.unref();
  }

  private async write(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, tracks: [...this.tracks.values()] }), 'utf8');
      await rename(tmp, this.file);
    } catch (err) {
      logger.warn({ err, file: this.file }, 'Kütüphane dizini kaydedilemedi');
    }
  }
}

function relativeTo(dir: string, path: string): string {
  const rel = relative(dir, path);
  return rel.startsWith('..') ? basename(path) : rel.replace(/\\/g, '/');
}

function uniquePath(dir: string, fileName: string): string {
  const { name, ext } = parse(fileName);
  let candidate = join(dir, fileName);
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`);
  return candidate;
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_TRACKS) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, depth + 1, out);
    else if (e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase())) out.push(full);
  }
}

export const libraryService = new LibraryService();
