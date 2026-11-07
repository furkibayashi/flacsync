import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import NodeID3 from 'node-id3';
import sanitizeFilename from 'sanitize-filename';
import { env } from '../config/env.js';
import { runFfmpeg } from '../utils/ffmpeg.js';
import { logger } from '../utils/logger.js';
import { ytDlpProcess } from '../utils/ytdlp.js';
import { fetchCoverAsJpeg } from './download/cover.js';
import type { TrackMetadata } from './metadata/types.js';
import type { ResolvedSource } from './resolver/types.js';

export type OutputFormat = 'mp3' | 'flac';
export type DownloadStage = 'downloading' | 'converting' | 'tagging';

export interface DownloadProgress {
  stage: DownloadStage;
  /** Aşama içi ilerleme, 0-100 */
  percent: number;
}

/** Albüm indirmelerinde eklenen etiketler */
export interface TagExtras {
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  /** TPE2 / ALBUMARTIST — tüm albüm parçalarında aynı olur */
  albumArtist?: string;
}

export interface DownloadRequest {
  /** Dosya ve klasör adlarında kullanılan benzersiz kimlik (job id) */
  id: string;
  metadata: TrackMetadata;
  source: ResolvedSource;
  format: OutputFormat;
  extras?: TagExtras;
  /** İptal: yt-dlp / ffmpeg süreçleri durdurulur */
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadedFile {
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
  format: OutputFormat;
  /** Kapak gömülebildi mi */
  hasCover: boolean;
}

export class DownloadError extends Error {
  readonly statusCode = 502;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DownloadError';
  }
}

const MIME: Record<OutputFormat, string> = { mp3: 'audio/mpeg', flac: 'audio/flac' };
const YTDLP_PROGRESS = /\[download\]\s+(\d+(?:\.\d+)?)%/;

export function buildFileName(meta: TrackMetadata, format: OutputFormat, extras: TagExtras = {}): string {
  // 01, 02 … (100+ parçalı listelerde 001)
  const width = Math.max(2, String(extras.trackTotal ?? extras.trackNumber ?? '').length);
  const prefix = extras.trackNumber ? `${String(extras.trackNumber).padStart(width, '0')} - ` : '';
  const base = sanitizeFilename(`${prefix}${meta.artist} - ${meta.title}`, { replacement: '_' })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return `${base || 'track'}.${format}`;
}

/** ID3v2 etiketleri (MP3). node-id3 yalnızca MP3 dosyalarını destekler. */
export function buildId3Tags(
  meta: TrackMetadata,
  source: ResolvedSource,
  cover: Buffer | null,
  extras: TagExtras = {},
): NodeID3.Tags {
  return {
    title: meta.title,
    artist: meta.artist,
    performerInfo: extras.albumArtist ?? meta.artist, // TPE2 — albüm sanatçısı
    ...(extras.trackNumber
      ? { trackNumber: extras.trackTotal ? `${extras.trackNumber}/${extras.trackTotal}` : String(extras.trackNumber) }
      : {}),
    ...(extras.discNumber ? { partOfSet: String(extras.discNumber) } : {}),
    ...(meta.album ? { album: meta.album } : {}),
    ...(meta.releaseDate ? { year: meta.releaseDate } : {}),
    ...(meta.isrc ? { ISRC: meta.isrc } : {}),
    ...(meta.duration ? { length: String(meta.duration * 1000) } : {}),
    comment: {
      language: 'eng',
      text: `Source: YouTube Music ${source.videoId} (${source.format.codec} ${source.format.bitrateKbps ?? '?'} kbps)`,
    },
    ...(cover
      ? {
          image: {
            mime: 'image/jpeg',
            type: { id: 3, name: 'front cover' },
            description: 'Cover',
            imageBuffer: cover,
          },
        }
      : {}),
  };
}

/** FLAC için Vorbis comment argümanları (ffmpeg -metadata). */
export function buildVorbisArgs(meta: TrackMetadata, source: ResolvedSource, extras: TagExtras = {}): string[] {
  const fields: Record<string, string | null> = {
    title: meta.title,
    artist: meta.artist,
    album_artist: extras.albumArtist ?? meta.artist,
    track: extras.trackNumber ? String(extras.trackNumber) : null,
    TRACKTOTAL: extras.trackTotal ? String(extras.trackTotal) : null,
    disc: extras.discNumber ? String(extras.discNumber) : null,
    album: meta.album,
    date: meta.releaseDate,
    ISRC: meta.isrc,
    comment: `Source: YouTube Music ${source.videoId} (${source.format.codec} ${source.format.bitrateKbps ?? '?'} kbps, lossy origin)`,
  };
  return Object.entries(fields).flatMap(([key, value]) => (value ? ['-metadata', `${key}=${value}`] : []));
}

/**
 * Audio Downloader & Tagging Engine
 *
 * 1. yt-dlp ile resolver'ın seçtiği ses formatını indirir (yoksa bestaudio).
 * 2. ffmpeg ile hedef formata çevirir:
 *      mp3  → libmp3lame, MP3_BITRATE kbps
 *      flac → FLAC_COMPRESSION_LEVEL, 16 bit; kapak ve Vorbis etiketleri burada gömülür
 * 3. MP3 için node-id3 ile ID3v2 etiketlerini ve kapağı gömer.
 *
 * Not: Kaynak (YouTube) kayıplıdır. FLAC/320k çıktı kaliteyi artırmaz,
 * yalnızca uyumluluk sağlar; bu bilgi dosyanın yorum etiketine de yazılır.
 */
export class DownloaderService {
  private readonly downloadDir = resolve(env.DOWNLOAD_DIR);
  private readonly tempDir = resolve(env.TEMP_DIR);

  async download(req: DownloadRequest): Promise<DownloadedFile> {
    const { id, metadata, source, format, extras = {} } = req;
    const report = (stage: DownloadStage, fraction: number) =>
      req.onProgress?.({ stage, percent: Math.round(Math.min(Math.max(fraction, 0), 1) * 100) });

    const outDir = join(this.downloadDir, id);
    await Promise.all([mkdir(this.tempDir, { recursive: true }), mkdir(outDir, { recursive: true })]);

    const fileName = buildFileName(metadata, format, extras);
    const outputPath = join(outDir, fileName);
    const coverPath = join(this.tempDir, `${id}.cover.jpg`);
    let rawAudio: string | null = null;

    try {
      // Kapak, ses indirilirken paralel hazırlanır; başarısız olursa kapaksız devam edilir
      const coverPromise: Promise<Buffer | null> = metadata.coverUrl
        ? fetchCoverAsJpeg(metadata.coverUrl, this.tempDir, `${id}.fetch`).catch((err) => {
            logger.warn({ err, id }, 'Kapak indirilemedi, kapaksız devam ediliyor');
            return null;
          })
        : Promise.resolve(null);

      // 1) İndirme
      report('downloading', 0);
      rawAudio = await this.fetchAudio(id, source, (f) => report('downloading', f), req.signal);
      report('downloading', 1);

      const cover = await coverPromise;

      // 2) Dönüştürme (+ FLAC için etiket/kapak)
      report('converting', 0);
      if (format === 'flac' && cover) await writeFile(coverPath, cover);
      await runFfmpeg({
        inputs: format === 'flac' && cover ? [rawAudio, coverPath] : [rawAudio],
        output: outputPath,
        args: this.conversionArgs(format, metadata, source, Boolean(cover), extras),
        durationSec: metadata.duration,
        onProgress: (f) => report('converting', f),
        signal: req.signal,
      });
      report('converting', 1);

      // 3) Etiketleme (MP3)
      report('tagging', 0);
      if (format === 'mp3') {
        const result = NodeID3.write(buildId3Tags(metadata, source, cover, extras), outputPath);
        if (result instanceof Error) throw new DownloadError(`ID3 etiketleri yazılamadı: ${result.message}`, { cause: result });
      }
      report('tagging', 1);

      const { size } = await stat(outputPath);
      return { path: outputPath, fileName, size, mimeType: MIME[format], format, hasCover: Boolean(cover) };
    } catch (err) {
      await rm(outDir, { recursive: true, force: true });
      throw err instanceof DownloadError ? err : new DownloadError((err as Error).message, { cause: err });
    } finally {
      await Promise.all([
        rawAudio ? rm(rawAudio, { force: true }) : Promise.resolve(),
        rm(coverPath, { force: true }),
      ]);
    }
  }

  /** Bir job'un çıktı klasörünü siler. */
  async remove(id: string): Promise<void> {
    await rm(join(this.downloadDir, id), { recursive: true, force: true });
  }

  private conversionArgs(
    format: OutputFormat,
    meta: TrackMetadata,
    source: ResolvedSource,
    withCover: boolean,
    extras: TagExtras,
  ): string[] {
    const common = ['-map', '0:a:0', '-map_metadata', '-1', '-y'];

    if (format === 'mp3') {
      return [
        ...common, '-vn', '-c:a', 'libmp3lame', '-b:a', `${env.MP3_BITRATE}k`,
        // LAME hız/kalite (0 en yavaş … 9 en hızlı). 320 kbps'de ve kayıplı kaynakta fark duyulmaz; 7 ölçümde ~%45 daha hızlı
        '-compression_level', String(env.MP3_ENCODER_SPEED),
        '-id3v2_version', '3',
      ];
    }

    return [
      ...common,
      ...(withCover
        ? [
            '-map', '1:v:0',
            '-c:v', 'copy',
            '-disposition:v:0', 'attached_pic',
            '-metadata:s:v', 'title=Album cover',
            '-metadata:s:v', 'comment=Cover (front)',
          ]
        : []),
      '-c:a', 'flac',
      '-compression_level', String(env.FLAC_COMPRESSION_LEVEL),
      '-sample_fmt', 's16',
      ...buildVorbisArgs(meta, source, extras),
    ];
  }

  /**
   * yt-dlp ile ham ses akışını geçici klasöre indirir, dosya yolunu döndürür.
   * Hızlı yol: eşleştirmede çekilen bilgi (--load-info-json) — bilgi ikinci kez çekilmez.
   * Akış bağlantısının süresi dolduysa (403 vb.) normal yola (sayfa adresi) döner.
   */
  private async fetchAudio(
    id: string,
    source: ResolvedSource,
    onProgress: (f: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (source.downloadInfo) {
      const infoPath = join(this.tempDir, `${id}.info.json`);
      try {
        await writeFile(infoPath, JSON.stringify(source.downloadInfo));
        return await this.runYtDlpDownload(id, '', { loadInfoJson: infoPath }, source, onProgress, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        logger.debug({ err, id }, 'Önbellekteki bilgiyle indirme başarısız, sayfa adresiyle yeniden deneniyor');
        await this.removeAudio(id);
      } finally {
        await rm(infoPath, { force: true });
      }
    }
    return this.runYtDlpDownload(id, source.pageUrl, { noPlaylist: true }, source, onProgress, signal);
  }

  private async runYtDlpDownload(
    id: string,
    url: string,
    extraFlags: Record<string, string | boolean>,
    source: ResolvedSource,
    onProgress: (f: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const subprocess = ytDlpProcess(
      url,
      {
        ...extraFlags,
        // Resolver'ın seçtiği format; yoksa en iyi ses
        format: `${source.format.formatId}/bestaudio/best`,
        output: join(this.tempDir, `${id}.audio.%(ext)s`),
        newline: true,
        noPart: true,
        noMtime: true,
      },
      { timeout: env.DOWNLOAD_TIMEOUT_MS },
    );
    const onAbort = () => subprocess.kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    let buffer = '';
    subprocess.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = YTDLP_PROGRESS.exec(line);
        if (match?.[1]) onProgress(Number(match[1]) / 100);
      }
    });

    try {
      await subprocess;
    } catch (err) {
      if (signal?.aborted) throw new DownloadError('İndirme iptal edildi', { cause: err });
      const stderr = (err as { stderr?: string }).stderr?.trim().split('\n').pop() ?? (err as Error).message;
      throw new DownloadError(`Ses indirilemedi: ${stderr}`, { cause: err });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    const file = (await readdir(this.tempDir)).find((f) => f.startsWith(`${id}.audio.`));
    if (!file) throw new DownloadError('yt-dlp tamamlandı ama ses dosyası bulunamadı');
    return join(this.tempDir, file);
  }

  private async removeAudio(id: string): Promise<void> {
    const files = (await readdir(this.tempDir)).filter((f) => f.startsWith(`${id}.audio.`));
    await Promise.all(files.map((f) => rm(join(this.tempDir, f), { force: true })));
  }
}

export const downloaderService = new DownloaderService();
