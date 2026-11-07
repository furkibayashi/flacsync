import { spawn } from 'node:child_process';
import { ffmpegPath } from './ffmpeg.js';

export interface AudioTags {
  /** Anahtarlar küçük harfli (title, artist, lyrics …) */
  tags: Record<string, string>;
  /** saniye */
  duration: number | null;
}

/**
 * ffmpeg'in ";FFMETADATA1" çıktısını ayrıştırır. Değerlerde "=", ";", "#", "\" ve satır sonu
 * ters bölüyle kaçırılır; satır sonuyla biten satır bir sonrakiyle birleşir (çok satırlı sözler).
 */
export function parseFfmetadata(out: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const lines = out.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (line.startsWith(';') || line.startsWith('[')) continue;
    // Tek sayıda ters bölüyle biten satır: değer bir sonraki satırda devam ediyor
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = `${line.slice(0, -1)}\n${lines[++i]!}`;
    }
    const eq = line.search(/(^|[^\\])=/);
    if (eq < 0) continue;
    const split = line[eq] === '=' ? eq : eq + 1;
    const key = line.slice(0, split).replace(/\\(.)/g, '$1').toLowerCase();
    if (!key || key in tags) continue;
    tags[key] = line.slice(split + 1).replace(/\\(.)/gs, '$1').trim();
  }
  return tags;
}

/** ffmpeg ile dosya etiketlerini ve süresini okur (ffprobe gerektirmez). Hata fırlatmaz. */
export function readTags(file: string): Promise<AudioTags> {
  return new Promise((done) => {
    if (!ffmpegPath) return done({ tags: {}, duration: null });
    const proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', file, '-f', 'ffmetadata', '-'], {
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', (d: Buffer) => out.push(d));
    proc.stderr.on('data', (d: Buffer) => {
      if (err.length < 20_000) err += d.toString('utf8');
    });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
    proc.on('error', () => {
      clearTimeout(timer);
      done({ tags: {}, duration: null });
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const duration = m ? Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
      done({ tags: parseFfmetadata(Buffer.concat(out).toString('utf8')), duration });
    });
  });
}
