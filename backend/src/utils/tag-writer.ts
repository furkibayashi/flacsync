import { rename, rm, stat } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import NodeID3 from 'node-id3';
import { runFfmpeg } from './ffmpeg.js';

/**
 * Var olan bir FLAC dosyasının Vorbis etiketlerini değiştirir. Ses ve kapak yeniden kodlanmaz
 * (-c copy), mevcut etiketler korunur (-map_metadata 0). Önce geçici dosyaya yazılır; boyut
 * denetiminden geçerse asıl dosyanın yerine konur — yarım dosya kalmaz.
 */
export async function rewriteFlacTags(file: string, metadataArgs: string[], tag = 'tags'): Promise<void> {
  if (metadataArgs.length === 0) return;
  const { dir, name } = parse(file);
  const tmp = join(dir, `.${name}.${tag}-${process.pid}.flac`);
  try {
    await runFfmpeg({ inputs: [file], output: tmp, args: ['-map', '0', '-map_metadata', '0', '-c', 'copy', '-y', ...metadataArgs] });
    const [before, after] = await Promise.all([stat(file), stat(tmp)]);
    if (after.size < before.size * 0.9) throw new Error(`Çıktı beklenenden küçük (${after.size} < ${before.size})`);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Dosyanın tür etiketini yazar (FLAC: GENRE, MP3: TCON). */
export async function writeGenreTag(file: string, genre: string): Promise<void> {
  const ext = extname(file).toLowerCase();
  if (ext === '.mp3') {
    const result = NodeID3.update({ genre }, file);
    if (result instanceof Error) throw result;
    return;
  }
  if (ext === '.flac') return rewriteFlacTags(file, ['-metadata', `genre=${genre}`], 'genre');
  throw new Error(`Desteklenmeyen dosya: ${ext}`);
}
