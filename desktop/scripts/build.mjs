// Electron ana sürecini + backend'i tek bir CJS dosyasına paketler (dist/main.cjs).
// Böylece exe'ye node_modules kopyalamaya gerek kalmaz.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Kurulum sihirbazının lisans sayfası için
mkdirSync(join(here, '..', 'build'), { recursive: true });
copyFileSync(join(here, '..', '..', 'LICENSE'), join(here, '..', 'build', 'license.txt'));

await build({
  entryPoints: [join(here, '..', 'src', 'main.ts')],
  outfile: join(here, '..', 'dist', 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
  external: ['electron'],
  // Backend ESM kodu import.meta.url kullanıyor; CJS çıktıda karşılığı tanımlanır
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
  alias: {
    // fluent-ffmpeg'in index.js'i var olmayan lib-cov'u koşullu require ediyor
    'fluent-ffmpeg': require.resolve('fluent-ffmpeg/lib/fluent-ffmpeg.js'),
  },
});

// Sandbox'lı preload: yalnızca 'electron' modülüne erişebilir, tek dosya olmalı
await build({
  entryPoints: [join(here, '..', 'src', 'preload.ts')],
  outfile: join(here, '..', 'dist', 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
});
