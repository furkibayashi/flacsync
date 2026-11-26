import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { copyFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { env } from '../config/env.js';
import PQueue from 'p-queue';
import { measureLoudness, readTags } from '../utils/audio-tags.js';
import { withFileLock, writeGenreTag } from '../utils/tag-writer.js';
import { canonicalGenre, genreService } from './genre.service.js';
import { ffmpegPath } from '../utils/ffmpeg.js';
import { readJsonSafely, writeJsonAtomic } from '../utils/json-store.js';
import { logger } from '../utils/logger.js';
import { songKey } from './library/song-key.js';
import { readEmbeddedLyrics } from './lyrics/tagger.js';
import { prefsService } from './prefs.service.js';
import { loudnessFromReplayGain, lrcPath, writeLrcSidecar, writeReplayGain } from '../utils/sidecars.js';
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
  /** Uygulamada kaç kez dinlendi (≥30 sn) */
  playCount: number;
  lastPlayedAt: string | null;
  /** Ölçülen yükseklik (LUFS); ses eşitleme için. Henüz ölçülmediyse null */
  loudness?: number | null;
  /** Kütüphane klasörüne göre yol (arayüzde gösterilir) */
  relativePath: string;
  /** Sesin geldiği YouTube kaydı ve eşleşme güveni (eski / elle eklenen dosyalarda bilinmeyebilir) */
  source?: TrackSource | null;
}

export interface TrackSource {
  videoId: string;
  /** 0-1; bilinmiyorsa null */
  score: number | null;
  strategy?: string | null;
  /** Kullanıcı "doğru" dedi ya da kaydı kendisi seçti */
  reviewed?: boolean;
}

/** Bu güvenin altındaki eşleşmeler (ISRC ile bulunanlar hariç) kontrol için işaretlenir */
export const REVIEW_SCORE = 0.9;

export function needsReview(source: TrackSource | null | undefined): boolean {
  return Boolean(source && !source.reviewed && source.strategy !== 'isrc' && source.score !== null && source.score < REVIEW_SCORE);
}

/** Dosyanın yorum etiketinden kaynak: "Source: YouTube Music <videoId> (…)" */
export function sourceFromComment(comment: string | null | undefined): TrackSource | null {
  const m = /Source:\s*YouTube(?: Music)?\s+([A-Za-z0-9_-]{11})\b/.exec(comment ?? '');
  return m ? { videoId: m[1]!, score: null } : null;
}

interface StoredTrack extends LibraryTrack {
  path: string;
  mtimeMs: number;
  /** ReplayGain etiketi dosyada var (yazıldı ya da zaten vardı) */
  rgWritten?: boolean;
}

export interface ScanStatus {
  running: boolean;
  /** Taranan / bulunan dosya */
  done: number;
  total: number;
  added: number;
}

export interface GenreFixStatus {
  running: boolean;
  total: number;
  done: number;
  changed: number;
  /** Etiketi dosyaya yazılamayanlar (ör. o an çalınan dosya) — listede yine düzeltilir */
  tagFailed: number;
  current: string | null;
  finishedAt: string | null;
}

export interface LibraryListing {
  tracks: LibraryTrack[];
  genres: { name: string; count: number }[];
  totalBytes: number;
  dir: string;
  /** Eklenen başka müzik klasörleri */
  folders: string[];
  scan: ScanStatus;
}

/** Klasör eklemede hata (geçersiz yol, iç içe klasör …) */
export class LibraryFolderError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: 'INVALID_FOLDER' | 'FOLDER_EXISTS',
    message: string,
  ) {
    super(message);
    this.name = 'LibraryFolderError';
  }
}

export const isInside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

interface PendingMeta {
  metadata: TrackMetadata;
  trackNumber: number | null;
  source?: TrackSource | null;
  at: number;
}

const AUDIO_EXT = new Set(['.mp3', '.flac']);
const MAX_SCAN_DEPTH = 4;
/** Eklenen müzik klasörleri genelde Sanatçı/Albüm/CD1 gibi daha derindir */
const MAX_EXTRA_DEPTH = 8;
const MAX_TRACKS = 20_000;
const WRITE_DELAY_MS = 800;
const PENDING_TTL_MS = 6 * 60 * 60_000;
/** "Kütüphanede var" eşleşmesinde izin verilen süre farkı (saniye) */
const MATCH_TOLERANCE_S = 4;

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
  /** Yükseklik ölçümü: arka planda, tek tek */
  private readonly loudQueue = new PQueue({ concurrency: 1 });
  private readonly loudPending = new Set<string>();

  /** Ölçülmemiş şarkıları sıraya alır (açılışta ve her eklemede) */
  measureMissing(): void {
    for (const t of this.tracks.values()) {
      if (t.loudness !== undefined || this.loudPending.has(t.id)) continue;
      this.loudPending.add(t.id);
      void this.loudQueue.add(async () => {
        const current = this.tracks.get(t.id);
        if (current && existsSync(current.path)) {
          current.loudness = await measureLoudness(current.path);
          this.scheduleWrite();
          if (prefsService.get().replayGain) await this.writeRg(current);
        }
        this.loudPending.delete(t.id);
      });
    }
  }

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
    prefsService.onChange((next, prev) => this.applyPrefs(next, prev));
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
      tracks: tracks.map(({ path: _p, mtimeMs: _m, rgWritten: _r, ...pub }) => ({ ...pub, playCount: pub.playCount ?? 0, lastPlayedAt: pub.lastPlayedAt ?? null, loudness: pub.loudness ?? null })),
      genres: [...genreCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      totalBytes,
      dir: this.dir,
      folders: prefsService.get().folders,
      scan: { ...this.scanStatus },
    };
  }

  /** Akış / kapak için gerçek yol — yalnızca dizindeki kayıtlar (keyfi dosya okunamaz). */
  filePath(id: string): string | null {
    const t = this.tracks.get(id);
    return t && existsSync(t.path) ? t.path : null;
  }

  /** Kapak değişti: önbellekteki küçük kopya silinir, sonraki istekte yeniden çıkarılır */
  invalidateCover(id: string): void {
    void rm(join(this.coverDir, `${id}.jpg`), { force: true }).catch(() => undefined);
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
    options: { folder?: string | null; trackNumber?: number | null; source?: TrackSource | null } = {},
  ): Promise<void> {
    const pending: PendingMeta = { metadata, trackNumber: options.trackNumber ?? null, source: options.source ?? null, at: Date.now() };
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
      void this.sidecarFor(target);
      this.emitAdded(jobId, trackId(target));
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
      void this.sidecarFor(path);
      this.emitAdded(jobId, trackId(path));
    } catch (err) {
      logger.warn({ err, jobId, path }, 'Kaydedilen dosya kütüphaneye eklenemedi');
    }
  }

  /**
   * Türü elle değiştirir: dizin hemen güncellenir, dosyanın etiketi de yazılır.
   * Etiket yazılamazsa (dosya kullanımda vb.) false döner, dizin yine de güncellenir.
   */
  async setGenre(id: string, genre: string | null): Promise<{ ok: boolean; tagWritten: boolean }> {
    const t = this.tracks.get(id);
    if (!t) return { ok: false, tagWritten: false };
    const value = canonicalGenre(genre);
    t.genre = value;
    this.scheduleWrite();
    if (!value) return { ok: true, tagWritten: false };
    try {
      await writeGenreTag(t.path, value);
      const s = await stat(t.path);
      t.size = s.size;
      t.mtimeMs = s.mtimeMs;
      this.scheduleWrite();
      return { ok: true, tagWritten: true };
    } catch (err) {
      logger.warn({ err, file: t.path }, 'Tür etiketi dosyaya yazılamadı');
      return { ok: true, tagWritten: false };
    }
  }

  private fixStatus: GenreFixStatus = {
    running: false,
    total: 0,
    done: 0,
    changed: 0,
    tagFailed: 0,
    current: null,
    finishedAt: null,
  };

  get genreFix(): GenreFixStatus {
    return this.fixStatus;
  }

  /**
   * Tüm kütüphanenin türünü iTunes + MusicBrainz ile yeniden belirler (arka planda).
   * Yalnızca değişenlerin dosyası yeniden etiketlenir.
   */
  startGenreFix(): GenreFixStatus {
    if (this.fixStatus.running) return this.fixStatus;
    const tracks = [...this.tracks.values()].filter((t) => existsSync(t.path));
    this.fixStatus = { running: true, total: tracks.length, done: 0, changed: 0, tagFailed: 0, current: null, finishedAt: null };
    void (async () => {
      for (const t of tracks) {
        this.fixStatus.current = `${t.artist} - ${t.title}`;
        try {
          const { genre } = await genreService.resolve({ title: t.title, artist: t.artist, album: t.album, hint: t.genre });
          if (genre && genre !== t.genre) {
            this.fixStatus.changed++;
            const r = await this.setGenre(t.id, genre);
            if (!r.tagWritten) this.fixStatus.tagFailed++;
          }
        } catch (err) {
          logger.debug({ err, id: t.id }, 'Tür düzeltilemedi');
        }
        this.fixStatus.done++;
      }
      this.fixStatus = { ...this.fixStatus, running: false, current: null, finishedAt: new Date().toISOString() };
      logger.info(this.fixStatus, 'Kütüphane türleri düzeltildi');
    })();
    return this.fixStatus;
  }

  /** Oynatıcı bildirir: şarkı en az 30 sn dinlendi */
  markPlayed(id: string): boolean {
    const t = this.tracks.get(id);
    if (!t) return false;
    t.playCount = (t.playCount ?? 0) + 1;
    t.lastPlayedAt = new Date().toISOString();
    this.scheduleWrite();
    return true;
  }

  private readonly addedListeners = new Set<(jobId: string, trackId: string) => void>();

  /** Bir indirme kütüphaneye girdi (liste senkronu, şarkıyı listeye eklemek için dinler) */
  onAdded(listener: (jobId: string, trackId: string) => void): () => void {
    this.addedListeners.add(listener);
    return () => this.addedListeners.delete(listener);
  }

  private emitAdded(jobId: string, id: string): void {
    for (const l of this.addedListeners) {
      try {
        l(jobId, id);
      } catch (err) {
        logger.warn({ err }, 'Kütüphane dinleyicisi hata verdi');
      }
    }
  }

  /** Araçlar için: kayıtlar gerçek dosya yollarıyla */
  entries(): Array<LibraryTrack & { path: string }> {
    return [...this.tracks.values()].filter((t) => existsSync(t.path)).map(({ mtimeMs: _m, ...t }) => ({ ...t }));
  }

  /** Dosya değişti (etiket düzenlendi): etiketleri yeniden okur, kimlik ve istatistikler korunur */
  async reread(id: string): Promise<LibraryTrack | null> {
    const t = this.tracks.get(id);
    if (!t) return null;
    await this.addFile(t.path, undefined, t.addedAt, id);
    const updated = this.tracks.get(id)!;
    updated.coverUrl = t.coverUrl;
    return this.track(id);
  }

  /**
   * Şarkının dosyasını yenisiyle değiştirir (yanlış kayıt düzeltmesi). Aynı yol ve kimlik korunur,
   * böylece çalma listeleri ve dinlenme sayısı bozulmaz. Eski dosya önce Geri Dönüşüm Kutusu'na gider.
   */
  async replaceFile(id: string, newFile: string, source: TrackSource): Promise<LibraryTrack | null> {
    const t = this.tracks.get(id);
    if (!t) return null;
    const target = t.path;
    const staged = `${target}.flacsync-new`;
    const old = `${target}.flacsync-old`;
    await copyFile(newFile, staged);
    try {
      await withFileLock(target, async () => {
        // Önce eski dosya kenara alınır, yeni dosya yerine konur; ancak ikisi de başarılıysa
        // eskisi çöpe gider. Arada bir şey başarısız olursa eski dosya geri konur.
        await rename(target, old);
        try {
          await rename(staged, target);
        } catch (err) {
          await rename(old, target).catch(() => undefined);
          throw err;
        }
      });
    } catch (err) {
      await rm(staged, { force: true }).catch(() => undefined);
      throw err;
    }
    try {
      if (this.trashHandler) await this.trashHandler(old);
      else await rm(old, { force: true });
    } catch (err) {
      logger.warn({ err, file: old }, 'Eski dosya çöpe gönderilemedi; yanında bırakıldı');
    }
    this.invalidateCover(id);
    await this.reread(id);
    // Yeni ses: yükseklik yeniden ölçülür
    const updated = this.tracks.get(id);
    if (updated) {
      updated.loudness = undefined;
      updated.rgWritten = false;
      updated.source = source;
      this.scheduleWrite();
    }
    return this.track(id);
  }

  /** Eşleşmeyi onaylar ya da yeni kaynağı kaydeder */
  setSource(id: string, source: TrackSource): LibraryTrack | null {
    const t = this.tracks.get(id);
    if (!t) return null;
    t.source = source;
    this.scheduleWrite();
    return this.track(id);
  }

  /** Dosya taşındı (klasör düzeni): kimlik korunur, yol güncellenir */
  relocate(id: string, newPath: string): void {
    const t = this.tracks.get(id);
    if (!t) return;
    t.path = resolve(newPath);
    t.relativePath = this.relativePath(newPath);
    this.scheduleWrite();
  }

  private trashHandler: ((file: string) => Promise<void>) | null = null;

  /** Masaüstü: silinenler Geri Dönüşüm Kutusu'na gitsin (shell.trashItem) */
  setTrashHandler(handler: (file: string) => Promise<void>): void {
    this.trashHandler = handler;
  }

  /** Dosyayı siler (masaüstünde Geri Dönüşüm Kutusu'na) ve kütüphaneden çıkarır */
  async deleteFile(id: string): Promise<{ trashed: boolean }> {
    const t = this.tracks.get(id);
    if (!t) return { trashed: false };
    if (this.trashHandler) await this.trashHandler(t.path);
    else await rm(t.path, { force: true });
    // Yanındaki .lrc de gider (yalnızca bizim yazdığımız ya da aynı adlı olan)
    const lrc = lrcPath(t.path);
    if (existsSync(lrc)) await (this.trashHandler ? this.trashHandler(lrc) : rm(lrc, { force: true })).catch(() => undefined);
    this.tracks.delete(id);
    this.scheduleWrite();
    return { trashed: Boolean(this.trashHandler) };
  }

  remove(id: string): boolean {
    const removed = this.tracks.delete(id);
    if (removed) this.scheduleWrite();
    return removed;
  }

  /** Klasörü tarar: yeni dosyaları ekler, silinmiş olanları çıkarır. */
  rescan(): Promise<{ added: number; removed: number }> {
    if (this.scanning) {
      // Sürmekte olan tarama eski klasör listesini kullanıyor: bittiğinde bir kez daha taranır
      this.rescanAgain = true;
      return this.scanning;
    }
    this.scanning = this.doRescan().finally(() => {
      this.scanning = null;
      this.scanStatus.running = false;
      if (this.rescanAgain) {
        this.rescanAgain = false;
        void this.rescan();
      }
    });
    return this.scanning;
  }

  private rescanAgain = false;

  private scanStatus: ScanStatus = { running: false, done: 0, total: 0, added: 0 };

  get scan(): ScanStatus {
    return { ...this.scanStatus };
  }

  /** Kütüphanenin kökleri: indirme klasörü + eklenen klasörler */
  roots(): string[] {
    return [this.dir, ...prefsService.get().folders];
  }

  /**
   * Var olan bir müzik klasörünü kütüphaneye ekler; arka planda taranır. Dosyalar taşınmaz,
   * kopyalanmaz; yalnızca dizine alınır.
   */
  addFolder(input: string): string[] {
    const folder = resolve(input.trim());
    if (!isAbsolute(input.trim())) throw new LibraryFolderError('INVALID_FOLDER', 'Klasör yolu tam olmalı');
    let isDir = false;
    try {
      isDir = statSync(folder).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new LibraryFolderError('INVALID_FOLDER', 'Klasör bulunamadı');
    // Kök sürücünün tamamı ya da zaten kapsanan / kapsayan bir klasör eklenmez
    if (parse(folder).root === folder) {
      throw new LibraryFolderError('INVALID_FOLDER', 'Sürücünün tamamı eklenemez; bir müzik klasörü seçin');
    }
    for (const root of this.roots()) {
      if (isInside(root, folder)) {
        throw new LibraryFolderError('FOLDER_EXISTS', 'Bu klasör zaten kütüphanede (ya da kütüphanedeki bir klasörün içinde)');
      }
    }
    // Yeni klasörün içinde kalan eklenmiş klasörler artık gereksiz: üst klasör hepsini kapsar
    const folders = [...prefsService.get().folders.filter((f) => !isInside(folder, f)), folder];
    prefsService.update({ folders });
    void this.rescan();
    return folders;
  }

  /** Klasörü kütüphaneden çıkarır (dosyalara dokunulmaz) */
  removeFolder(input: string): string[] {
    const folder = resolve(input);
    const folders = prefsService.get().folders.filter((f) => resolve(f).toLowerCase() !== folder.toLowerCase());
    prefsService.update({ folders });
    let removed = 0;
    for (const [id, t] of this.tracks) {
      if (isInside(folder, t.path) && !this.roots().some((r) => isInside(r, t.path))) {
        this.tracks.delete(id);
        removed++;
      }
    }
    if (removed) this.scheduleWrite();
    return folders;
  }

  /** Tercih açıldı: eksik ReplayGain etiketlerini / .lrc dosyalarını arka planda yazar */
  applyPrefs(next: { lrcSidecar: boolean; replayGain: boolean }, prev: { lrcSidecar: boolean; replayGain: boolean }): void {
    if (next.replayGain && !prev.replayGain) {
      for (const t of this.tracks.values()) if (typeof t.loudness === 'number' && !t.rgWritten) void this.loudQueue.add(() => this.writeRg(t));
    }
    if (next.lrcSidecar && !prev.lrcSidecar) {
      for (const t of this.tracks.values()) if (!existsSync(lrcPath(t.path))) void this.loudQueue.add(() => this.sidecarFor(t.path));
    }
  }

  private async writeRg(t: StoredTrack): Promise<void> {
    if (typeof t.loudness !== 'number' || t.rgWritten || !existsSync(t.path)) return;
    // Eklenen klasörlerdeki dosyalar kullanıcınındır: yeniden yazılmaz
    if (!isInside(this.dir, t.path)) return;
    try {
      await writeReplayGain(t.path, t.loudness);
      const s = await stat(t.path);
      t.size = s.size;
      t.mtimeMs = s.mtimeMs;
      t.rgWritten = true;
      this.scheduleWrite();
    } catch (err) {
      logger.debug({ err, file: t.path }, 'ReplayGain etiketi yazılamadı');
    }
  }

  /** Tercih açıksa dosyanın gömülü sözlerinden yanına .lrc yazar */
  private async sidecarFor(file: string): Promise<void> {
    if (!prefsService.get().lrcSidecar || !existsSync(file) || !isInside(this.dir, file)) return;
    try {
      const lyrics = await readEmbeddedLyrics(file);
      if (lyrics) await writeLrcSidecar(file, lyrics);
    } catch (err) {
      logger.debug({ err, file }, '.lrc yazılamadı');
    }
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
    this.scanStatus = { running: true, done: 0, total: 0, added: 0 };
    // Takılı olmayan bir sürücüdeki (USB, ağ) klasörün şarkıları silinmez: sürücü geri gelince
    // dinlenme sayıları ve diğer bilgiler yerinde olsun. Yalnızca erişilebilen köklerde temizlik yapılır.
    const roots = this.roots();
    const reachable = roots.filter((r) => existsSync(r));
    const unreachable = roots.filter((r) => !reachable.includes(r));
    let removed = 0;
    for (const [id, t] of this.tracks) {
      if (existsSync(t.path)) continue;
      if (unreachable.some((r) => isInside(r, t.path)) && !reachable.some((r) => isInside(r, t.path))) continue;
      this.tracks.delete(id);
      removed++;
    }
    const found: string[] = [];
    await walk(this.dir, 0, found, MAX_SCAN_DEPTH);
    for (const folder of prefsService.get().folders) {
      if (existsSync(folder)) await walk(folder, 0, found, MAX_EXTRA_DEPTH);
      this.scanStatus.total = found.length;
    }
    // Üst klasör eklendiyse indirme klasörü iki kez gezilmiş olabilir
    const seen = new Set<string>();
    const files = found.filter((f) => {
      const key = resolve(f).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const byPath = new Map([...this.tracks.values()].map((t) => [t.path.toLowerCase(), t.id]));
    let added = 0;
    this.scanStatus = { running: true, done: 0, total: files.length, added: 0 };
    for (const file of files) {
      this.scanStatus.done++;
      if (this.tracks.size >= MAX_TRACKS) break;
      // Tarama sürerken klasör kütüphaneden çıkarıldıysa o dosyalar eklenmez
      if (!this.roots().some((r) => isInside(r, file))) continue;
      const id = byPath.get(resolve(file).toLowerCase()) ?? trackId(file);
      const existing = this.tracks.get(id);
      if (existing) {
        const s = await stat(file).catch(() => null);
        if (s && s.mtimeMs === existing.mtimeMs) continue;
      }
      try {
        await this.addFile(file, undefined, existing?.addedAt, id);
        if (!existing) {
          added++;
          this.scanStatus.added = added;
        }
      } catch (err) {
        logger.debug({ err, file }, 'Dosya okunamadı');
      }
    }
    this.scanStatus = { ...this.scanStatus, running: false };
    if (added || removed) this.scheduleWrite();
    return { added, removed };
  }

  private async addFile(path: string, pending?: PendingMeta, addedAt?: string, keepId?: string): Promise<void> {
    const ext = extname(path).toLowerCase();
    if (!AUDIO_EXT.has(ext)) return;
    const s = await stat(path);
    const meta = pending?.metadata;
    // İndirmeden gelen metadata yeterli; yalnızca bilinmeyen dosyalar ffmpeg ile okunur
    const read = meta ? null : await readTags(path);
    const tags = read?.tags ?? {};
    const trackRaw = first(tags, 'track', 'tracknumber');
    // Taşınan / yeniden etiketlenen dosya kimliğini korur (çalma listeleri bozulmasın)
    const id = keepId ?? trackId(path);

    const track: StoredTrack = {
      id,
      path: resolve(path),
      mtimeMs: s.mtimeMs,
      title: meta?.title ?? first(tags, 'title') ?? parse(path).name,
      artist: meta?.artist ?? first(tags, 'artist', 'album_artist', 'albumartist') ?? '',
      album: meta?.album ?? first(tags, 'album'),
      genre: canonicalGenre(meta?.genre ?? first(tags, 'genre')),
      year: meta?.releaseDate ?? first(tags, 'date', 'year')?.slice(0, 4) ?? null,
      trackNumber: pending?.trackNumber ?? (trackRaw ? Number.parseInt(trackRaw, 10) || null : null),
      duration: meta?.duration ?? read?.duration ?? null,
      format: ext === '.flac' ? 'flac' : 'mp3',
      size: s.size,
      coverUrl: meta?.coverUrl ?? null,
      addedAt: addedAt ?? this.tracks.get(id)?.addedAt ?? new Date().toISOString(),
      playCount: this.tracks.get(id)?.playCount ?? 0,
      lastPlayedAt: this.tracks.get(id)?.lastPlayedAt ?? null,
      relativePath: this.relativePath(path),
      source: pending?.source ?? this.tracks.get(id)?.source ?? sourceFromComment(first(tags, 'comment', 'description')),
    };
    // Ölçülen yükseklik, etiket yeniden okununca kaybolmasın; dosyada ReplayGain varsa ölçmeye gerek yok
    const prev = this.tracks.get(id);
    const tagged = read ? loudnessFromReplayGain(first(tags, 'replaygain_track_gain')) : null;
    if (prev?.loudness !== undefined) {
      track.loudness = prev.loudness;
      track.rgWritten = prev.rgWritten || tagged !== null;
    } else if (tagged !== null) {
      track.loudness = tagged;
      track.rgWritten = true;
    }
    this.tracks.set(id, track);
    this.scheduleWrite();
    setTimeout(() => this.measureMissing(), 2000).unref();
  }

  /** Arayüzde gösterilen yol: indirme klasörüne göre; eklenen klasörlerde "KlasörAdı/…" */
  private relativePath(path: string): string {
    if (isInside(this.dir, path)) return relativeTo(this.dir, path);
    const root = prefsService.get().folders.find((f) => isInside(f, path));
    return root ? `${basename(root)}/${relativeTo(root, path)}` : basename(path);
  }

  private prunePending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) if (p.at < cutoff) this.pending.delete(id);
  }

  private load(): void {
    // Bozuksa kenara alınır ve yedekten okunur (boşuyla ezilmez)
    const data = readJsonSafely<{ tracks?: StoredTrack[] }>(this.file, (raw) =>
      raw && typeof raw === 'object' ? (raw as { tracks?: StoredTrack[] }) : null,
    );
    if (!data) return;
    for (const t of data.tracks ?? []) if (t?.id && t.path) this.tracks.set(t.id, t);
    setTimeout(() => this.measureMissing(), 10_000).unref();
  }

  private keyCache: Map<string, Array<{ id: string; duration: number | null }>> | null = null;

  /**
   * "sanatçı|başlık" → şarkı kimliği. Arama sonuçlarında / albümlerde "kütüphanende var" göstermek
   * ve liste senkronunda tekrar indirmemek için. Kütüphane değişince yeniden kurulur.
   */
  private keyIndex(): Map<string, Array<{ id: string; duration: number | null }>> {
    if (!this.keyCache) {
      const map = new Map<string, Array<{ id: string; duration: number | null }>>();
      for (const t of this.tracks.values()) {
        const key = songKey(t.artist, t.title);
        const list = map.get(key);
        const entry = { id: t.id, duration: t.duration };
        if (list) list.push(entry);
        else map.set(key, [entry]);
      }
      this.keyCache = map;
    }
    return this.keyCache;
  }

  /**
   * Aynı şarkı kütüphanede var mı? Sanatçı + başlık eşleşmeli; iki tarafın da süresi biliniyorsa
   * en fazla 4 sn fark olmalı. Böylece aynı sanatçının farklı albümlerdeki
   * "Intro"su ya da "Outro"su "zaten var" sayılmaz.
   */
  find(artist: string, title: string, duration?: number | null): string | null {
    const candidates = this.keyIndex().get(songKey(artist, title));
    if (!candidates) return null;
    const hit = candidates.find(
      (c) => this.filePath(c.id) && (!duration || !c.duration || Math.abs(c.duration - duration) <= MATCH_TOLERANCE_S),
    );
    return hit?.id ?? null;
  }

  /** Verilen şarkılardan kütüphanede olanların kimlikleri (aynı sırayla, yoksa null) */
  match(items: Array<{ artist: string; title: string; duration?: number | null }>): Array<string | null> {
    return items.map((i) => this.find(i.artist, i.title, i.duration));
  }

  private scheduleWrite(): void {
    this.keyCache = null;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writing = this.writing.then(() => this.write());
    }, WRITE_DELAY_MS);
    this.writeTimer.unref();
  }

  private async write(): Promise<void> {
    try {
      await writeJsonAtomic(this.file, { version: 1, tracks: [...this.tracks.values()] });
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

async function walk(dir: string, depth: number, out: string[], maxDepth: number): Promise<void> {
  if (depth > maxDepth || out.length >= MAX_TRACKS) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    // Gizli ve sistem klasörleri ($RECYCLE.BIN, System Volume Information, .git …) atlanır
    if (e.isDirectory() && !/^[.$]|^System Volume Information$/i.test(e.name)) await walk(full, depth + 1, out, maxDepth);
    else if (e.isFile() && !e.name.startsWith('.') && AUDIO_EXT.has(extname(e.name).toLowerCase())) out.push(full);
  }
}

export const libraryService = new LibraryService();
