import { existsSync, mkdirSync } from 'node:fs';
import { readdir, rename, rmdir } from 'node:fs/promises';
import { dirname, extname, join, parse, relative, resolve, sep } from 'node:path';
import axios from 'axios';
import PQueue from 'p-queue';
import sanitizeFilename from 'sanitize-filename';
import { env } from '../config/env.js';
import { readTags } from '../utils/audio-tags.js';
import { logger } from '../utils/logger.js';
import { writeTags, type TagFields } from '../utils/tag-writer.js';
import { fetchCoverAsJpeg } from './download/cover.js';
import { genreService } from './genre.service.js';
import { libraryService, type LibraryTrack } from './library.service.js';
import { lyricsService } from './lyrics/lyrics.service.js';
import { artistSimilarity, splitArtists, stripTitleNoise, titleSimilarity } from './matcher/similarity.js';

/**
 * Kütüphane araçları:
 *  - Sağlık taraması: kapak, söz, tür, yıl, albüm, albüm sanatçısı eksik dosyalar; tek tıkla tamamlama
 *  - Kopya bulucu: aynı şarkının birden fazla dosyası (MP3 + FLAC vb.)
 *  - Klasör düzeni: şablona göre dosyaları yeniden adlandır / taşı (önizlemeli)
 *  - Etiket düzenleyici: alanları ve kapağı elle değiştir
 */

export type HealthIssue = 'cover' | 'lyrics' | 'genre' | 'year' | 'album' | 'albumArtist';
export const HEALTH_ISSUES: HealthIssue[] = ['cover', 'lyrics', 'genre', 'year', 'album', 'albumArtist'];

export interface HealthItem {
  id: string;
  title: string;
  artist: string;
  issues: HealthIssue[];
}

export interface HealthReport {
  running: boolean;
  /** 'scan' = tarıyor, 'fix' = tamamlıyor */
  phase: 'scan' | 'fix' | null;
  total: number;
  done: number;
  items: HealthItem[];
  counts: Record<HealthIssue, number>;
  fixed: number;
  failed: number;
  finishedAt: string | null;
}

export interface DuplicateGroup {
  key: string;
  title: string;
  artist: string;
  /** İlki önerilen (FLAC > büyük dosya > çok etiket) */
  tracks: Array<LibraryTrack & { bitrate: number | null; recommended: boolean }>;
}

export interface OrganizeMove {
  id: string;
  from: string;
  to: string;
}

export const DEFAULT_TEMPLATE = '{albumartist}/{year} - {album}/{track} - {title}';

const emptyCounts = (): Record<HealthIssue, number> => ({ cover: 0, lyrics: 0, genre: 0, year: 0, album: 0, albumArtist: 0 });

interface ITunesSong {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionArtistName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
}

/** iTunes'ta şarkıyı bulur: albüm, yıl, albüm sanatçısı ve büyük kapak için */
async function lookupSong(title: string, artist: string): Promise<ITunesSong | null> {
  const primary = splitArtists(artist)[0] ?? artist;
  const clean = stripTitleNoise(title);
  const { data } = await axios.get<{ results?: ITunesSong[] }>('https://itunes.apple.com/search', {
    params: { term: `${primary} ${clean}`, entity: 'song', limit: 10, country: env.APPLE_MUSIC_STOREFRONT },
    timeout: 8000,
  });
  return (
    (data.results ?? [])
      .map((s) => ({ s, score: titleSimilarity(clean, s.trackName ?? '') + artistSimilarity(artist, s.artistName ?? '') }))
      .filter((x) => x.score >= 1.5)
      .sort((a, b) => b.score - a.score)[0]?.s ?? null
  );
}

const norm = (s: string) =>
  s
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export class LibraryToolsService {
  private health: HealthReport = {
    running: false,
    phase: null,
    total: 0,
    done: 0,
    items: [],
    counts: emptyCounts(),
    fixed: 0,
    failed: 0,
    finishedAt: null,
  };

  get healthReport(): HealthReport {
    return this.health;
  }

  // --- Sağlık taraması ---------------------------------------------------------------------------

  startHealthScan(): HealthReport {
    if (this.health.running) return this.health;
    const entries = libraryService.entries();
    this.health = { running: true, phase: 'scan', total: entries.length, done: 0, items: [], counts: emptyCounts(), fixed: 0, failed: 0, finishedAt: null };
    const queue = new PQueue({ concurrency: 3 });
    void Promise.all(
      entries.map((t) =>
        queue.add(async () => {
          const { tags, hasCover } = await readTags(t.path);
          const issues: HealthIssue[] = [];
          if (!hasCover) issues.push('cover');
          if (!Object.keys(tags).some((k) => k.startsWith('lyrics') || k === 'unsyncedlyrics')) issues.push('lyrics');
          if (!tags.genre) issues.push('genre');
          if (!tags.date && !tags.year) issues.push('year');
          if (!tags.album) issues.push('album');
          if (!tags.album_artist && !tags.albumartist && !tags['album artist']) issues.push('albumArtist');
          if (issues.length) {
            this.health.items.push({ id: t.id, title: t.title, artist: t.artist, issues });
            for (const i of issues) this.health.counts[i]++;
          }
          this.health.done++;
        }),
      ),
    ).then(() => {
      this.health.items.sort((a, b) => b.issues.length - a.issues.length || a.artist.localeCompare(b.artist));
      this.health = { ...this.health, running: false, phase: null, finishedAt: new Date().toISOString() };
    });
    return this.health;
  }

  /** Taramada bulunan eksikleri (ya da yalnızca seçilen şarkılarınkini) internetten tamamlar */
  startHealthFix(ids?: string[]): HealthReport {
    if (this.health.running) return this.health;
    const targets = this.health.items.filter((i) => !ids || ids.includes(i.id));
    this.health = { ...this.health, running: true, phase: 'fix', total: targets.length, done: 0, fixed: 0, failed: 0, finishedAt: null };
    void (async () => {
      for (const item of targets) {
        try {
          const remaining = await this.fixOne(item);
          if (remaining.length < item.issues.length) this.health.fixed++;
          // Kalan eksikler listede kalır
          item.issues = remaining;
        } catch (err) {
          this.health.failed++;
          logger.warn({ err, id: item.id }, 'Eksikler tamamlanamadı');
        }
        this.health.done++;
      }
      this.health.items = this.health.items.filter((i) => i.issues.length > 0);
      this.health.counts = emptyCounts();
      for (const i of this.health.items) for (const k of i.issues) this.health.counts[k]++;
      this.health = { ...this.health, running: false, phase: null, finishedAt: new Date().toISOString() };
    })();
    return this.health;
  }

  private async fixOne(item: HealthItem): Promise<HealthIssue[]> {
    const track = libraryService.track(item.id);
    const file = libraryService.filePath(item.id);
    if (!track || !file) return item.issues;
    const need = new Set(item.issues);
    const fields: TagFields = {};
    let cover: Buffer | undefined;

    const metaNeeded = need.has('album') || need.has('year') || need.has('albumArtist') || need.has('cover');
    const song = metaNeeded ? await lookupSong(track.title, track.artist).catch(() => null) : null;
    if (song) {
      if (need.has('album') && song.collectionName) fields.album = song.collectionName.replace(/ - (Single|EP)$/i, '');
      if (need.has('year') && song.releaseDate) fields.year = song.releaseDate.slice(0, 4);
      if (need.has('albumArtist')) fields.albumArtist = song.collectionArtistName ?? song.artistName ?? track.artist;
    } else if (need.has('albumArtist')) {
      fields.albumArtist = splitArtists(track.artist)[0] ?? track.artist;
    }
    if (need.has('genre')) {
      const g = await genreService.resolve({ title: track.title, artist: track.artist, album: track.album });
      if (g.genre) fields.genre = g.genre;
    }
    if (need.has('cover')) {
      const url = track.coverUrl ?? song?.artworkUrl100?.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/1000x1000bb.jpg');
      if (url) cover = await fetchCoverAsJpeg(url, resolve(env.TEMP_DIR), `${item.id}.heal`).catch(() => undefined);
    }

    if (Object.keys(fields).length || cover) {
      mkdirSync(resolve(env.TEMP_DIR), { recursive: true });
      await writeTags(file, fields, cover);
    }
    let lyricsOk = !need.has('lyrics');
    if (need.has('lyrics')) {
      const r = await lyricsService.fetchAndEmbed(
        file,
        { title: track.title, artist: track.artist, album: fields.album ?? track.album, duration: track.duration },
        { force: true },
      );
      lyricsOk = r.status === 'embedded';
    }
    await libraryService.reread(item.id);
    if (cover) libraryService.invalidateCover(item.id);

    const remaining: HealthIssue[] = [];
    if (need.has('cover') && !cover) remaining.push('cover');
    if (!lyricsOk) remaining.push('lyrics');
    if (need.has('genre') && !fields.genre) remaining.push('genre');
    if (need.has('year') && !fields.year) remaining.push('year');
    if (need.has('album') && !fields.album) remaining.push('album');
    if (need.has('albumArtist') && !fields.albumArtist) remaining.push('albumArtist');
    return remaining;
  }

  // --- Kopya bulucu ------------------------------------------------------------------------------

  async duplicates(): Promise<DuplicateGroup[]> {
    const groups = new Map<string, Array<LibraryTrack & { path: string }>>();
    for (const t of libraryService.entries()) {
      const key = `${norm(splitArtists(t.artist)[0] ?? t.artist)}|${norm(stripTitleNoise(t.title))}`;
      if (!key.replace('|', '')) continue;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    const result: DuplicateGroup[] = [];
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      // Süresi çok farklı olanlar (canlı / uzun sürüm) kopya sayılmaz
      const base = list[0]!.duration ?? 0;
      const same = list.filter((t) => !base || !t.duration || Math.abs(t.duration - base) <= 4);
      if (same.length < 2) continue;
      const withBitrate = await Promise.all(
        same.map(async (t) => ({ ...t, bitrate: (await readTags(t.path)).bitrate })),
      );
      withBitrate.sort(
        (a, b) =>
          Number(b.format === 'flac') - Number(a.format === 'flac') || (b.bitrate ?? 0) - (a.bitrate ?? 0) || b.size - a.size,
      );
      result.push({
        key,
        title: same[0]!.title,
        artist: same[0]!.artist,
        tracks: withBitrate.map(({ path: _p, ...t }, i) => ({ ...t, recommended: i === 0 })),
      });
    }
    return result.sort((a, b) => a.artist.localeCompare(b.artist));
  }

  // --- Klasör düzeni -----------------------------------------------------------------------------

  /** Şablona göre her dosyanın yeni yolu; değişmeyecekler listelenmez */
  async organizePreview(template: string): Promise<OrganizeMove[]> {
    const root = libraryService.dir;
    const taken = new Set<string>();
    const moves: OrganizeMove[] = [];
    const entries = libraryService.entries();
    // Mevcut, taşınmayacak yollar da "dolu" sayılır
    for (const t of entries) taken.add(t.path.toLowerCase());
    for (const t of entries) {
      const { tags } = await readTags(t.path);
      const target = buildPath(root, template, t, tags, extname(t.path));
      if (target.toLowerCase() === t.path.toLowerCase()) continue;
      let final = target;
      for (let i = 1; taken.has(final.toLowerCase()); i++) {
        const p = parse(target);
        final = join(p.dir, `${p.name} (${i})${p.ext}`);
      }
      taken.add(final.toLowerCase());
      moves.push({ id: t.id, from: relative(root, t.path), to: relative(root, final) });
    }
    return moves;
  }

  async organizeApply(template: string): Promise<{ moved: number; failed: number }> {
    const root = libraryService.dir;
    const moves = await this.organizePreview(template);
    let moved = 0;
    let failed = 0;
    const touchedDirs = new Set<string>();
    for (const m of moves) {
      const from = join(root, m.from);
      const to = join(root, m.to);
      try {
        mkdirSync(dirname(to), { recursive: true });
        if (existsSync(to)) throw new Error('Hedef dosya var');
        await rename(from, to);
        libraryService.relocate(m.id, to);
        touchedDirs.add(dirname(from));
        moved++;
      } catch (err) {
        failed++;
        logger.warn({ err, from, to }, 'Dosya taşınamadı');
      }
    }
    // Boşalan klasörleri (yalnızca kütüphane içinde) temizle
    for (const dir of [...touchedDirs].sort((a, b) => b.length - a.length)) await removeEmptyUp(dir, root);
    return { moved, failed };
  }

  // --- Etiket düzenleyici ------------------------------------------------------------------------

  async editTags(id: string, fields: TagFields, coverUrl?: string | null, coverData?: Buffer | null): Promise<LibraryTrack | null> {
    const file = libraryService.filePath(id);
    if (!file) return null;
    let cover: Buffer | undefined;
    if (coverData) cover = coverData;
    else if (coverUrl) {
      mkdirSync(resolve(env.TEMP_DIR), { recursive: true });
      cover = await fetchCoverAsJpeg(coverUrl, resolve(env.TEMP_DIR), `${id}.edit`);
    }
    await writeTags(file, fields, cover);
    const track = await libraryService.reread(id);
    if (cover) libraryService.invalidateCover(id);
    return track;
  }
}

const TOKEN = /\{(artist|albumartist|album|year|track|disc|title|genre)\}/gi;

function buildPath(root: string, template: string, t: LibraryTrack, tags: Record<string, string>, ext: string): string {
  const values: Record<string, string> = {
    artist: t.artist || 'Unknown Artist',
    albumartist: tags.album_artist || tags.albumartist || splitArtists(t.artist)[0] || t.artist || 'Unknown Artist',
    album: t.album || 'Singles',
    year: t.year || '0000',
    track: t.trackNumber ? String(t.trackNumber).padStart(2, '0') : '',
    disc: (tags.disc ?? '1').split('/')[0] ?? '1',
    title: t.title || 'Untitled',
    genre: t.genre || 'Unknown',
  };
  const segments = template
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.replace(TOKEN, (_m, k: string) => values[k.toLowerCase()] ?? ''))
    // Boş kalan alanın ayıracı ("00 - Şarkı" yerine "Şarkı")
    .map((seg) => seg.replace(/^[\s\-–.]+|[\s\-–.]+$/g, '').replace(/\s+[-–]\s+(?=[-–])/g, ' '))
    .map((seg) => sanitizeFilename(seg.replace(/\s+/g, ' ').trim(), { replacement: '_' }).replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120))
    .filter(Boolean);
  if (segments.length === 0) segments.push(values.title ?? 'track');
  segments[segments.length - 1] += ext;
  return join(root, ...segments);
}

async function removeEmptyUp(dir: string, root: string): Promise<void> {
  let current = resolve(dir);
  const top = resolve(root);
  while (current.startsWith(top + sep) && current !== top) {
    const rest = await readdir(current).catch(() => ['x']);
    if (rest.length > 0) return;
    await rmdir(current).catch(() => undefined);
    current = dirname(current);
  }
}

export const libraryToolsService = new LibraryToolsService();
