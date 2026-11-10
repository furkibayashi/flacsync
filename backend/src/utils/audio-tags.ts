import { spawn } from 'node:child_process';
import { ffmpegPath } from './ffmpeg.js';

export interface AudioTags {
  /** Anahtarlar küçük harfli (title, artist, lyrics …) */
  tags: Record<string, string>;
  /** saniye */
  duration: number | null;
  /** Gömülü kapak var mı */
  hasCover: boolean;
  /** kbps (biliniyorsa) */
  bitrate: number | null;
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
    if (!ffmpegPath) return done({ tags: {}, duration: null, hasCover: false, bitrate: null });
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
      done({ tags: {}, duration: null, hasCover: false, bitrate: null });
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const duration = m ? Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
      const bitrate = Number(/bitrate:\s*(\d+)\s*kb\/s/.exec(err)?.[1]) || null;
      const hasCover = /Stream #\d+:\d+.*Video:/.test(err);
      done({ tags: parseFfmetadata(Buffer.concat(out).toString('utf8')), duration, hasCover, bitrate });
    });
  });
}

/**
 * Şarkının algılanan yüksekliği (EBU R128 entegre yükseklik, LUFS). Ses eşitleme için.
 * Dosyanın tamamı çözüldüğü için birkaç saniye sürer; arka planda, sırayla çağrılmalı.
 */
export function measureLoudness(file: string): Promise<number | null> {
  return new Promise((done) => {
    if (!ffmpegPath) return done(null);
    const proc = spawn(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
      { windowsHide: true },
    );
    let err = '';
    proc.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8');
      if (err.length > 200_000) err = err.slice(-50_000);
    });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 120_000);
    proc.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const all = [...err.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
      const value = all.length ? Number(all[all.length - 1]![1]) : NaN;
      done(Number.isFinite(value) && value > -70 ? value : null);
    });
  });
}
