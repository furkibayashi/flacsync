// npm, güvenlik nedeniyle paket kurulum betiklerini çalıştırmadığında (veya `--ignore-scripts`
// ile kurulduğunda) gerekli ikili dosyaları indirir: yt-dlp, ffmpeg, esbuild, Electron.
//
// yt-dlp-exec'in kurulumu Python arar; Windows'ta bağımsız yt-dlp.exe kullanıldığı için
// Python gerekmez. Bu betik o kontrolü atlayıp doğrudan indirme adımını çalıştırır.
//
//   npm install --ignore-scripts
//   npm run setup:binaries
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  { name: 'yt-dlp', dir: 'node_modules/yt-dlp-exec', script: 'scripts/postinstall.js' },
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
process.exit(failed ? 1 : 0);
