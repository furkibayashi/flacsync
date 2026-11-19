import { randomUUID } from 'node:crypto';
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import NodeID3 from 'node-id3';
import { runFfmpeg } from './ffmpeg.js';

/**
 * Aynı dosyaya aynı anda iki yazma (ör. "türleri düzelt" + elle etiket) birbirini ezmesin:
 * dosya başına sıra. Anahtar küçük harf (Windows yolları büyük-küçük harf duyarsız).
 */
const locks = new Map<string, Promise<unknown>>();

export function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const key = file.toLowerCase();
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(key, next);
  void next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => undefined);
  return next;
}

/**
 * Var olan bir FLAC dosyasının Vorbis etiketlerini değiştirir. Ses yeniden kodlanmaz (-c copy),
 * mevcut etiketler korunur (-map_metadata 0). `cover` verilirse gömülü kapak onunla değişir.
 * Önce geçici dosyaya yazılır; boyut denetiminden geçerse asıl dosyanın yerine konur.
 */
export function rewriteFlacTags(file: string, metadataArgs: string[], tag = 'tags', cover?: Buffer): Promise<void> {
  if (metadataArgs.length === 0 && !cover) return Promise.resolve();
  return withFileLock(file, () => rewriteFlacTagsNow(file, metadataArgs, tag, cover));
}

async function rewriteFlacTagsNow(file: string, metadataArgs: string[], tag: string, cover?: Buffer): Promise<void> {
  const { dir, name } = parse(file);
  // Her yazma kendi geçici dosyasını kullanır (eskiden aynı ad paylaşılıyordu)
  const unique = randomUUID().slice(0, 8);
  const tmp = join(dir, `.${name}.${tag}-${unique}.flac`);
  const coverFile = cover ? join(dir, `.${name}.cover-${unique}.jpg`) : null;
  try {
    let inputs = [file];
    let maps = ['-map', '0'];
    if (cover && coverFile) {
      await writeFile(coverFile, cover);
      inputs = [file, coverFile];
      // Eski kapak atılır, yenisi eklenir
      maps = ['-map', '0:a', '-map', '1:v', '-disposition:v:0', 'attached_pic', '-metadata:s:v', 'comment=Cover (front)'];
    }
    await runFfmpeg({ inputs, output: tmp, args: [...maps, '-map_metadata', '0', '-c', 'copy', '-y', ...metadataArgs] });
    const [before, after] = await Promise.all([stat(file), stat(tmp)]);
    if (after.size < before.size * 0.5) throw new Error(`Çıktı beklenenden küçük (${after.size} < ${before.size})`);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    if (coverFile) await rm(coverFile, { force: true }).catch(() => undefined);
  }
}

/** Dosyanın tür etiketini yazar (FLAC: GENRE, MP3: TCON). */
export async function writeGenreTag(file: string, genre: string): Promise<void> {
  return writeTags(file, { genre });
}

export interface TagFields {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  year?: string | null;
  genre?: string | null;
  trackNumber?: number | null;
}

/** Verilen alanları (null = sil değil, dokunma) ve isteğe bağlı kapağı dosyaya yazar. */
export async function writeTags(file: string, fields: TagFields, cover?: Buffer): Promise<void> {
  const ext = extname(file).toLowerCase();
  const set = <T>(v: T | null | undefined): v is T => v !== undefined && v !== null && v !== '';
  if (ext === '.mp3') {
    const tags: NodeID3.Tags = {};
    if (set(fields.title)) tags.title = fields.title;
    if (set(fields.artist)) tags.artist = fields.artist;
    if (set(fields.album)) tags.album = fields.album;
    if (set(fields.albumArtist)) tags.performerInfo = fields.albumArtist;
    if (set(fields.year)) tags.year = fields.year;
    if (set(fields.genre)) tags.genre = fields.genre;
    if (set(fields.trackNumber)) tags.trackNumber = String(fields.trackNumber);
    if (cover) {
      tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: cover };
    }
    // Eşzamansız sürüm: büyük dosyada sunucuyu (ve SSE akışlarını) bloklamaz
    await withFileLock(file, () => NodeID3.Promise.update(tags, file));
    return;
  }
  if (ext === '.flac') {
    const map: Record<string, string | number | null | undefined> = {
      title: fields.title,
      artist: fields.artist,
      album: fields.album,
      album_artist: fields.albumArtist,
      date: fields.year,
      genre: fields.genre,
      track: fields.trackNumber,
    };
    const args = Object.entries(map).flatMap(([k, v]) => (set(v) ? ['-metadata', `${k}=${v}`] : []));
    return rewriteFlacTags(file, args, 'tags', cover);
  }
  throw new Error(`Desteklenmeyen dosya: ${ext}`);
}
