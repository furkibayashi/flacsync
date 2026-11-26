import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { readTags } from '../utils/audio-tags.js';
import { ffmpegPath } from '../utils/ffmpeg.js';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';
import { downloaderService } from './downloader.service.js';
import { libraryService, type LibraryTrack } from './library.service.js';
import { lyricsService } from './lyrics/lyrics.service.js';
import type { TrackMetadata } from './metadata/types.js';
import { ResolverError, resolverService, type RematchCandidate } from './resolver.service.js';

/** YouTube / YouTube Music bağlantısından ya da çıplak kimlikten video kimliği */
export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    id = url.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Gömülü kapağı tam boyutta çıkarır (yoksa null) */
function embeddedCover(file: string, out: string): Promise<Buffer | null> {
  return new Promise((done) => {
    if (!ffmpegPath) return done(null);
    const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', file, '-an', '-frames:v', '1', '-q:v', '2', out], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
    proc.on('error', () => done(null));
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !existsSync(out)) return done(null);
      void readFile(out)
        .then(done, () => done(null))
        .finally(() => void rm(out, { force: true }));
    });
  });
}

const metaOf = (t: LibraryTrack): TrackMetadata => ({
  title: t.title,
  artist: t.artist,
  album: t.album,
  releaseDate: t.year,
  coverUrl: null,
  isrc: null,
  duration: t.duration,
  genre: t.genre,
});

/**
 * "Yanlış kayıt mı?" — kütüphanedeki bir şarkı için YouTube'daki adayları listeler ve
 * kullanıcının seçtiği kayıtla dosyayı yerinde yeniden oluşturur. Etiketler, kapak ve sözler
 * eski dosyadan alınır; yalnızca ses değişir.
 */
export class RematchService {
  private readonly running = new Set<string>();

  private require(id: string): { track: LibraryTrack; path: string } {
    const track = libraryService.track(id);
    const path = libraryService.filePath(id);
    if (!track || !path) throw new HttpError(404, 'TRACK_NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
    return { track, path };
  }

  async candidates(id: string): Promise<{ current: string | null; candidates: RematchCandidate[] }> {
    const { track } = this.require(id);
    const candidates = await resolverService.candidates(metaOf(track));
    return { current: track.source?.videoId ?? null, candidates };
  }

  async apply(id: string, input: string): Promise<LibraryTrack> {
    const videoId = parseVideoId(input);
    if (!videoId) throw new HttpError(400, 'INVALID_VIDEO', 'Geçerli bir YouTube / YouTube Music bağlantısı değil');
    const { track, path } = this.require(id);
    if (this.running.has(id)) throw new HttpError(409, 'BUSY', 'Bu şarkı zaten değiştiriliyor');
    this.running.add(id);
    const jobId = `rematch-${randomUUID()}`;
    try {
      const meta = metaOf(track);
      const tempDir = resolve(env.TEMP_DIR);
      await mkdir(tempDir, { recursive: true });
      const [source, cover, lyrics, old] = await Promise.all([
        resolverService.fromVideo(videoId, meta),
        embeddedCover(path, join(tempDir, `${jobId}.cover.jpg`)),
        lyricsService.forFile(path, { title: track.title, artist: track.artist, album: track.album, duration: track.duration }).catch(() => null),
        readTags(path),
      ]);
      // Eski dosyanın diğer etiketleri de taşınır (albüm sanatçısı, disk, toplam parça, ISRC)
      const tag = (...keys: string[]) => keys.map((k) => old.tags[k]).find((v) => v && v.trim()) ?? null;
      const int = (v: string | null) => (v ? Number.parseInt(v, 10) || undefined : undefined);
      const trackTag = tag('track', 'tracknumber');
      const extras = {
        trackNumber: track.trackNumber ?? int(trackTag),
        trackTotal: int(trackTag?.includes('/') ? trackTag.split('/')[1]! : tag('tracktotal', 'totaltracks')),
        discNumber: int(tag('disc', 'discnumber')),
        albumArtist: tag('album_artist', 'albumartist') ?? undefined,
      };
      meta.isrc = tag('isrc', 'tsrc');
      const file = await downloaderService.download({
        id: jobId,
        metadata: meta,
        source,
        format: track.format,
        extras: Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined && v !== null)),
        presetCover: cover,
        presetLyrics: lyrics,
      });
      const updated = await libraryService.replaceFile(id, file.path, {
        videoId,
        score: source.match.score,
        strategy: 'manual',
        reviewed: true,
      });
      if (!updated) throw new HttpError(404, 'TRACK_NOT_FOUND', 'Şarkı kütüphanede bulunamadı');
      logger.info({ id, from: track.source?.videoId ?? null, to: videoId, score: source.match.score }, 'Şarkının kaydı değiştirildi');
      return updated;
    } catch (err) {
      if (err instanceof ResolverError && err.code === 'NO_MATCH') {
        throw new HttpError(404, 'VIDEO_UNAVAILABLE', err.message);
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM') {
        throw new HttpError(409, 'FILE_IN_USE', 'Dosya şu an kullanımda (çalıyor olabilir); durdurup yeniden deneyin');
      }
      throw err;
    } finally {
      this.running.delete(id);
      await downloaderService.remove(jobId).catch(() => undefined);
    }
  }

  /** Eşleşme doğru: kontrol listesinden çıkar */
  confirm(id: string): LibraryTrack {
    const { track } = this.require(id);
    const updated = libraryService.setSource(id, {
      ...(track.source ?? { videoId: '', score: null }),
      reviewed: true,
    });
    return updated ?? track;
  }
}

export const rematchService = new RematchService();
