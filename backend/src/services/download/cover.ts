import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { http } from '../metadata/http.js';
import { runFfmpeg } from '../../utils/ffmpeg.js';

/**
 * Kapak yalnızca bilinen müzik CDN'lerinden indirilir. Metadata her zaman
 * sunucu tarafında üretilse de bu liste, olası bir SSRF'e karşı ikinci kilit.
 */
const ALLOWED_COVER_HOSTS = [
  /(^|\.)scdn\.co$/i,
  /(^|\.)spotifycdn\.com$/i,
  /(^|\.)mzstatic\.com$/i,
  /(^|\.)dzcdn\.net$/i,
  /(^|\.)ytimg\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)ggpht\.com$/i,
];

const MAX_COVER_BYTES = 15 * 1024 * 1024;
/** Gömülü kapak boyutu: çoğu oynatıcı için yeterli, dosyayı şişirmez. */
const MAX_COVER_EDGE = 1400;

export function isAllowedCoverUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_COVER_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * Kapağı indirir ve gömülmeye uygun JPEG'e çevirir (YouTube WebP döndürebilir).
 * Uzun kenar en fazla 1400 px olacak şekilde küçültülür.
 */
export async function fetchCoverAsJpeg(coverUrl: string, workDir: string, baseName: string): Promise<Buffer> {
  if (!isAllowedCoverUrl(coverUrl)) {
    throw new Error(`Kapak adresine izin verilmiyor: ${new URL(coverUrl).hostname}`);
  }

  const { data } = await http.get<ArrayBuffer>(coverUrl, {
    responseType: 'arraybuffer',
    maxContentLength: MAX_COVER_BYTES,
    timeout: 15_000,
  });

  const source = join(workDir, `${baseName}.cover-src`);
  const target = join(workDir, `${baseName}.cover.jpg`);
  try {
    await writeFile(source, Buffer.from(data));
    await runFfmpeg({
      inputs: [source],
      output: target,
      args: [
        '-vf', `scale='min(${MAX_COVER_EDGE},iw)':'min(${MAX_COVER_EDGE},ih)':force_original_aspect_ratio=decrease`,
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
      ],
    });
    return await readFile(target);
  } finally {
    await Promise.all([rm(source, { force: true }), rm(target, { force: true })]);
  }
}
