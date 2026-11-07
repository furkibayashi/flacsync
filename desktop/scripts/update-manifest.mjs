// Uygulama içi güncelleme için latest.yml üretir: node desktop/scripts/update-manifest.mjs <klasör>
//
// electron-builder de latest.yml üretir, ancak kurulum dosyası sonradan imzalanınca (SignPath)
// özet değeri değişir ve güncelleme "sha512 checksum mismatch" ile reddedilir. Bu yüzden
// manifest, yayınlanacak son dosyadan yeniden hesaplanır.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-release';
const setup = readdirSync(dir).find((f) => /^FlacSync-Setup-(\d+\.\d+\.\d+.*)\.exe$/.test(f));
if (!setup) {
  console.error(`Kurulum dosyası bulunamadı: ${dir}`);
  process.exit(1);
}
const version = /^FlacSync-Setup-(.+)\.exe$/.exec(setup)[1];
const file = join(dir, setup);

const sha512 = await new Promise((resolve, reject) => {
  const hash = createHash('sha512');
  createReadStream(file)
    .on('data', (d) => hash.update(d))
    .on('error', reject)
    .on('end', () => resolve(hash.digest('base64')));
});
const size = statSync(file).size;

const yml = [
  `version: ${version}`,
  'files:',
  `  - url: ${setup}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${setup}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');
writeFileSync(join(dir, 'latest.yml'), yml, 'ascii');
console.log(yml);
