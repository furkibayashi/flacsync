import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parse, join } from 'node:path';
import NodeID3 from 'node-id3';
import { rewriteFlacTags, withFileLock } from './tag-writer.js';

/** ReplayGain 2.0 referans yüksekliği (LUFS) */
export const REPLAYGAIN_REFERENCE = -18;

/** "song.flac" → "song.lrc" (aynı klasör, aynı ad) */
export function lrcPath(audioFile: string): string {
  const p = parse(audioFile);
  return join(p.dir, `${p.name}.lrc`);
}

/** FlacSync'in yazdığı .lrc dosyalarının ilk satırı: kullanıcının kendi dosyasını ezmemek için */
const MARK = '[re:FlacSync]';

/**
 * Şarkının yanına .lrc söz dosyası yazar. Zaman damgalı söz yoksa düz metin yazılır.
 * Aynı adla kullanıcının kendi .lrc dosyası varsa dokunulmaz. Yazıldıysa true.
 */
export async function writeLrcSidecar(audioFile: string, lyrics: { synced: string | null; plain: string | null }): Promise<boolean> {
  const body = lyrics.synced ?? lyrics.plain;
  if (!body?.trim()) return false;
  const target = lrcPath(audioFile);
  if (existsSync(target)) {
    const head = (await readFile(target, 'utf8').catch(() => '')).slice(0, 64);
    if (!head.startsWith(MARK)) return false;
  }
  await writeFile(target, `${MARK}\n${body.trim()}\n`, 'utf8');
  return true;
}

/** "−6.52 dB" biçiminde ReplayGain kazancı */
export function replayGainValue(lufs: number): string {
  const gain = REPLAYGAIN_REFERENCE - lufs;
  return `${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`;
}

/** Etiketteki kazançtan yükseklik (LUFS); okunamazsa null */
export function loudnessFromReplayGain(tag: string | null | undefined): number | null {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*dB/i.exec(tag ?? '');
  if (!m) return null;
  const lufs = REPLAYGAIN_REFERENCE - Number(m[1]);
  return Number.isFinite(lufs) && lufs > -70 && lufs < 10 ? Math.round(lufs * 10) / 10 : null;
}

/** REPLAYGAIN_TRACK_GAIN etiketini yazar (MP3: TXXX, FLAC: Vorbis comment). Ses değişmez. */
export async function writeReplayGain(file: string, lufs: number): Promise<void> {
  const value = replayGainValue(lufs);
  const ext = parse(file).ext.toLowerCase();
  if (ext === '.mp3') {
    await withFileLock(file, () =>
      NodeID3.Promise.update({ userDefinedText: [{ description: 'REPLAYGAIN_TRACK_GAIN', value }] }, file),
    );
    return;
  }
  if (ext === '.flac') {
    await rewriteFlacTags(file, ['-metadata', `REPLAYGAIN_TRACK_GAIN=${value}`], 'rg');
    return;
  }
  throw new Error(`Desteklenmeyen dosya: ${ext}`);
}
