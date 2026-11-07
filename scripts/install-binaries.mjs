// npm, güvenlik nedeniyle paket kurulum betiklerini çalıştırmadığında (veya `--ignore-scripts`
// ile kurulduğunda) gerekli ikili dosyaları indirir: yt-dlp, ffmpeg, esbuild, Electron.
//
// Windows'ta yt-dlp'nin "klasör" sürümü (yt-dlp_win.zip) de vendor/yt-dlp/ altına açılır:
// tek dosyalık exe her çalıştırmada kendini geçici klasöre açtığı için ~0,85 sn daha yavaş başlar.
//
//   npm install --ignore-scripts
//   npm run setup:binaries
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  { name: 'yt-dlp (tek dosya)', dir: 'node_modules/yt-dlp-exec', script: 'scripts/postinstall.js' },
  { name: 'ffmpeg', dir: 'node_modules/ffmpeg-static', script: 'install.js' },
  { name: 'esbuild', dir: 'node_modules/esbuild', script: 'install.js' },
  { name: 'electron', dir: 'node_modules/electron', script: 'install.js' },
];

let failed = false;
for (const step of steps) {
  const cwd = join(root, step.dir);
  if (!existsSync(join(cwd, step.script))) {
    console.log(`- ${step.name}: kurulu değil, atlandı`);
    continue;
  }
  process.stdout.write(`- ${step.name}: indiriliyor… `);
  const result = spawnSync(process.execPath, [step.script], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status === 0) {
    console.log('tamam');
  } else {
    failed = true;
    console.log('BAŞARISIZ');
    console.error(result.stderr?.toString().trim());
  }
}

/** ZIP'i hedef klasöre açar; arşiv dışına yazmaya çalışan girdileri reddeder. */
function extractZip(zipPath, target) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const dest = normalize(join(target, entry.fileName));
        if (!dest.startsWith(normalize(target) + sep)) return reject(new Error(`Geçersiz yol: ${entry.fileName}`));
        if (entry.fileName.endsWith('/')) {
          mkdirSync(dest, { recursive: true });
          return zip.readEntry();
        }
        mkdirSync(dirname(dest), { recursive: true });
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          pipeline(stream, createWriteStream(dest)).then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  });
}

async function installYtDlpOnedir() {
  if (process.platform !== 'win32') return;
  process.stdout.write('- yt-dlp (klasör sürümü): indiriliyor… ');
  const target = join(root, 'vendor', 'yt-dlp');
  const zipPath = join(root, 'vendor', 'yt-dlp_win.zip');
  try {
    mkdirSync(join(root, 'vendor'), { recursive: true });
    const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip');
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(zipPath));
    rmSync(target, { recursive: true, force: true });
    await extractZip(zipPath, target);
    rmSync(zipPath, { force: true });
    if (!existsSync(join(target, 'yt-dlp.exe'))) throw new Error('arşivde yt-dlp.exe yok');
    console.log('tamam');
  } catch (err) {
    failed = true;
    console.log('BAŞARISIZ');
    console.error(err instanceof Error ? err.message : err);
  }
}

await installYtDlpOnedir();
process.exit(failed ? 1 : 0);
