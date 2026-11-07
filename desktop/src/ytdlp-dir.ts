// yt-dlp "klasör" sürümünün (yt-dlp_win.zip) kurulumu ve güncellenmesi.
// Tek dosyalık yt-dlp.exe her çalıştırmada kendini geçici klasöre açtığı için yavaş başlar
// (ölçümde 1,36 sn → 0,51 sn). Klasör sürümü kendini güncelleyemediği için güncelleme burada yapılır.
import { execFile } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

const LATEST_ZIP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip';
const LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

/** Kullanıcı klasöründeki yt-dlp'yi hazırlar: yoksa ya da uygulama sürümü değiştiyse paketle geleni kopyalar. */
export function ensureYtDlpDir(bundledDir: string, targetDir: string, appVersion: string): void {
  const marker = join(targetDir, '.flacsync-version');
  const installedFor = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  const exe = join(targetDir, 'yt-dlp.exe');
  if (existsSync(exe) && installedFor === appVersion) return;
  if (!existsSync(join(bundledDir, 'yt-dlp.exe'))) throw new Error(`yt-dlp bulunamadı: ${bundledDir}`);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(bundledDir, targetDir, { recursive: true });
  writeFileSync(marker, appVersion, 'utf8');
}

export function ytDlpVersion(exe: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, ['--version'], { timeout: 30_000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    );
  });
}

function extractZip(zipPath: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('ZIP açılamadı'));
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        const dest = normalize(join(target, entry.fileName));
        if (!dest.startsWith(normalize(target) + sep)) return reject(new Error(`Geçersiz yol: ${entry.fileName}`));
        if (entry.fileName.endsWith('/')) {
          mkdirSync(dest, { recursive: true });
          return zip.readEntry();
        }
        mkdirSync(dirname(dest), { recursive: true });
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('ZIP girdisi okunamadı'));
          pipeline(stream, createWriteStream(dest)).then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  });
}

export interface UpdateResult {
  updated: boolean;
  from: string;
  to: string;
}

/**
 * En son yt-dlp sürümünü GitHub'dan indirip kurar. Önce yan klasöre açılır, çalıştığı
 * doğrulanınca eskisiyle yer değiştirilir — yarım kalan güncelleme mevcut kurulumu bozmaz.
 */
export async function updateYtDlpDir(targetDir: string, tempDir: string): Promise<UpdateResult> {
  const exe = join(targetDir, 'yt-dlp.exe');
  const current = await ytDlpVersion(exe).catch(() => 'bilinmiyor');

  const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FlacSync' } });
  if (!res.ok) throw new Error(`GitHub sürüm bilgisi alınamadı (HTTP ${res.status})`);
  const latest = ((await res.json()) as { tag_name?: string }).tag_name ?? '';
  if (latest && latest === current) return { updated: false, from: current, to: latest };

  mkdirSync(tempDir, { recursive: true });
  const zipPath = join(tempDir, 'yt-dlp_win.zip');
  const next = `${targetDir}.next`;
  const old = `${targetDir}.old`;
  rmSync(next, { recursive: true, force: true });

  const zip = await fetch(LATEST_ZIP, { headers: { 'User-Agent': 'FlacSync' } });
  if (!zip.ok || !zip.body) throw new Error(`yt-dlp indirilemedi (HTTP ${zip.status})`);
  await pipeline(Readable.fromWeb(zip.body as import('node:stream/web').ReadableStream), createWriteStream(zipPath));
  await extractZip(zipPath, next);
  rmSync(zipPath, { force: true });

  const installed = await ytDlpVersion(join(next, 'yt-dlp.exe'));
  // Sürüm işareti korunur: uygulama güncellenene kadar ensureYtDlpDir bu kurulumu ezmez
  const markerPath = join(targetDir, '.flacsync-version');
  const marker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : null;
  rmSync(old, { recursive: true, force: true });
  renameSync(targetDir, old);
  renameSync(next, targetDir);
  rmSync(old, { recursive: true, force: true });
  if (marker !== null) writeFileSync(markerPath, marker, 'utf8');
  return { updated: true, from: current, to: installed };
}
