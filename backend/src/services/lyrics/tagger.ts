import { rename, rm, stat } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import NodeID3 from 'node-id3';
import { readTags } from '../../utils/audio-tags.js';
import { runFfmpeg } from '../../utils/ffmpeg.js';
import { LyricsTagWriteError } from './errors.js';
import { parseLrc } from './lrc.js';
import type { EmbedFormat, Lyrics } from './types.js';

/**
 * Windows komut satırı ~32 bin karakterle sınırlı; sözler ffmpeg'e argüman olarak gider.
 * Bundan uzun sözler (pratikte olmaz) kısaltılmaz, düz metne düşülür ya da atlanır.
 */
const MAX_ARG_CHARS = 24_000;

export function formatOf(file: string): EmbedFormat | null {
  const ext = extname(file).toLowerCase();
  return ext === '.flac' ? 'flac' : ext === '.mp3' ? 'mp3' : null;
}

/** Gömülecek metin: zaman damgalı varsa o (LRC), yoksa düz söz. */
function primaryText(lyrics: Lyrics): string | null {
  const text = lyrics.synced ?? lyrics.plain;
  if (text && text.length <= MAX_ARG_CHARS) return text;
  return lyrics.plain && lyrics.plain.length <= MAX_ARG_CHARS ? lyrics.plain : null;
}

/**
 * FLAC Vorbis comment argümanları (ffmpeg -metadata).
 * LYRICS = LRC (foobar2000, MusicBee, Poweramp, Navidrome zaman damgalı gösterir);
 * UNSYNCEDLYRICS = düz metin (yalnızca LRC'yi tanımayan oynatıcılar için).
 */
export function vorbisLyricsArgs(lyrics: Lyrics): string[] {
  const text = primaryText(lyrics);
  if (!text) return [];
  const args = ['-metadata', `LYRICS=${text}`];
  if (lyrics.synced && lyrics.plain && text !== lyrics.plain && lyrics.plain.length <= MAX_ARG_CHARS) {
    args.push('-metadata', `UNSYNCEDLYRICS=${lyrics.plain}`);
  }
  return args;
}

/** MP3: USLT (metin; LRC ise zaman damgalarıyla) + SYLT (ID3'ün kendi senkron söz çerçevesi). */
export function id3LyricsTags(lyrics: Lyrics): Pick<NodeID3.Tags, 'unsynchronisedLyrics' | 'synchronisedLyrics'> {
  const text = lyrics.synced ?? lyrics.plain;
  if (!text) return {};
  const lines = lyrics.synced ? parseLrc(lyrics.synced) : [];
  return {
    unsynchronisedLyrics: { language: 'und', text },
    ...(lines.length > 0
      ? {
          synchronisedLyrics: [
            {
              language: 'und',
              timeStampFormat: NodeID3.TagConstants.TimeStampFormat.MILLISECONDS,
              contentType: NodeID3.TagConstants.SynchronisedLyrics.ContentType.LYRICS,
              shortText: 'Lyrics',
              synchronisedText: lines.map((l) => ({ text: l.text, timeStamp: l.timeMs })),
            },
          ],
        }
      : {}),
  };
}

/**
 * Var olan bir FLAC / MP3 dosyasına sözleri yazar.
 * FLAC: ffmpeg ile ses ve kapak yeniden kodlanmadan kopyalanır (-c copy), yalnızca etiket eklenir;
 * önce geçici dosyaya yazılır, başarılıysa asıl dosyanın yerine konur (yarım dosya kalmaz).
 */
export async function embedLyricsInFile(file: string, lyrics: Lyrics): Promise<void> {
  const format = formatOf(file);
  if (!format) throw new LyricsTagWriteError(file, 'Yalnızca FLAC ve MP3 dosyalarına söz yazılabilir', { unsupported: true });

  if (format === 'mp3') {
    const tags = id3LyricsTags(lyrics);
    if (!tags.unsynchronisedLyrics) return;
    const result = NodeID3.update(tags, file);
    if (result instanceof Error) throw new LyricsTagWriteError(file, `ID3 sözleri yazılamadı: ${result.message}`, { cause: result });
    return;
  }

  const args = vorbisLyricsArgs(lyrics);
  if (args.length === 0) return;
  const { dir, name } = parse(file);
  const tmp = join(dir, `.${name}.lyrics-${process.pid}.flac`);
  try {
    // -map 0: ses + gömülü kapak; -map_metadata 0: mevcut etiketler korunur
    await runFfmpeg({ inputs: [file], output: tmp, args: ['-map', '0', '-map_metadata', '0', '-c', 'copy', '-y', ...args] });
    const [before, after] = await Promise.all([stat(file), stat(tmp)]);
    // Basit bütünlük denetimi: ses kopyalandığı için boyut neredeyse aynı kalmalı
    if (after.size < before.size * 0.9) throw new Error(`Çıktı beklenenden küçük (${after.size} < ${before.size})`);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw new LyricsTagWriteError(file, `FLAC sözleri yazılamadı: ${(err as Error).message}`, { cause: err });
  }
}

/** Dosyada zaten söz var mı / neler var (oynatıcıda göstermek için). */
export async function readEmbeddedLyrics(file: string): Promise<Lyrics | null> {
  const format = formatOf(file);
  if (!format) return null;
  let text: string | null = null;
  if (format === 'mp3') {
    const tags = NodeID3.read(file, { include: ['USLT'] });
    text = tags.unsynchronisedLyrics?.text?.trim() || null;
  } else {
    const { tags } = await readTags(file);
    text = (tags.lyrics ?? tags['lyrics-und'] ?? tags.unsyncedlyrics ?? null)?.trim() || null;
  }
  if (!text) return null;
  const synced = parseLrc(text).length >= 2 ? text : null;
  return { source: 'embedded', synced, plain: synced ? null : text, instrumental: false, match: null };
}
