import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { env } from '../config/env.js';

// ffmpeg-static CJS modülü doğrudan yolu (string) export eder; tip tanımı bunu namespace olarak görüyor
const ffmpegPath = env.FFMPEG_PATH ?? (ffmpegStatic as unknown as string | null);
if (!ffmpegPath) {
  throw new Error('ffmpeg bulunamadı: FFMPEG_PATH tanımlayın veya ffmpeg-static kurulumunu kontrol edin.');
}
ffmpeg.setFfmpegPath(ffmpegPath);

export { ffmpeg };

/** "00:01:23.45" → 83.45 */
export function timemarkToSeconds(timemark: string | undefined): number {
  if (!timemark) return 0;
  return timemark
    .split(':')
    .map(Number)
    .reduce((acc, part) => acc * 60 + (Number.isFinite(part) ? part : 0), 0);
}

export interface FfmpegJob {
  inputs: string[];
  output: string;
  /**
   * Her eleman ayrı bir argümandır. fluent-ffmpeg'e tek dizi verilince
   * "title=A B" gibi boşluklu değerler bölünebildiği için spread ile geçilir.
   */
  args: string[];
  /** Saniye cinsinden toplam süre → yüzde hesabı */
  durationSec?: number | null;
  onProgress?: (fraction: number) => void;
}

export function runFfmpeg({ inputs, output, args, durationSec, onProgress }: FfmpegJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    for (const input of inputs) cmd.input(input);
    if (args.length > 0) cmd.outputOptions(...(args as [string, ...string[]]));

    cmd
      .on('progress', (p: { timemark?: string; percent?: number }) => {
        if (!onProgress) return;
        const fraction = durationSec
          ? timemarkToSeconds(p.timemark) / durationSec
          : typeof p.percent === 'number'
            ? p.percent / 100
            : 0;
        onProgress(Math.min(Math.max(fraction, 0), 1));
      })
      .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
        const tail = stderr?.trim().split('\n').slice(-3).join(' | ');
        reject(new Error(`ffmpeg hatası: ${err.message}${tail ? ` (${tail})` : ''}`, { cause: err }));
      })
      .on('end', () => resolve())
      .save(output);
  });
}
