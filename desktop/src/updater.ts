// Uygulama içi güncelleme.
//
// - Kurulum (NSIS) sürümü: electron-updater, GitHub Releases'teki latest.yml'yi okur, yeni
//   kurulumu indirir (sha512 doğrulanır) ve "Yeniden başlat ve güncelle" ile sessizce kurar.
// - Portable sürüm: GitHub API'den son sürümün portable exe'si indirilir, SHA256SUMS ile
//   doğrulanır. Portable başlatıcı çalışırken exe kilitli olduğundan (yeniden adlandırılamaz),
//   gizli bir yardımcı (uygulamanın exe'si Node kipinde) kapanmayı bekler, yeni exe'yi yerine taşır
//   ve yeniden açar.
//
// Yerel deneme için: FLACSYNC_UPDATE_FEED=http://127.0.0.1:8080 (latest.yml + kurulum dosyası)
// ve FLACSYNC_RELEASE_API=http://127.0.0.1:8080/release.json (portable).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';

const REPO = 'furkibayashi/flacsync';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASE_API = process.env.FLACSYNC_RELEASE_API ?? `https://api.github.com/repos/${REPO}/releases/latest`;
const FEED = process.env.FLACSYNC_UPDATE_FEED;
/** Uygulama ortamı değiştirmeden önceki değişkenler: yeniden açılan sürüm bunlarla başlar */
const ORIGINAL_ENV = { ...process.env };


export type UpdateMode = 'installer' | 'portable' | 'dev';
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  mode: UpdateMode;
  currentVersion: string;
  version: string | null;
  notes: string | null;
  /** 0-100 */
  progress: number | null;
  bytesPerSecond: number | null;
  error: string | null;
  releasesUrl: string;
  checkedAt: string | null;
}

interface GitHubRelease {
  tag_name: string;
  body?: string;
  html_url?: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** "1.10.0" > "1.9.2" */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

const stripHtml = (s: string) =>
  s
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function notesOf(info: UpdateInfo): string | null {
  const n = info.releaseNotes;
  if (!n) return null;
  if (typeof n === 'string') return stripHtml(n);
  return n.map((x) => stripHtml(x.note ?? '')).join('\n\n');
}

export class Updater {
  private state: UpdateState;
  private portableRelease: { version: string; exeUrl: string; sumsUrl: string | null } | null = null;
  private portableFile: string | null = null;
  private busy: Promise<unknown> | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly quit: () => void,
  ) {
    const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
    const mode: UpdateMode = portableExe ? 'portable' : app.isPackaged || FEED ? 'installer' : 'dev';
    this.state = {
      status: mode === 'dev' ? 'unsupported' : 'idle',
      mode,
      currentVersion: app.getVersion(),
      version: null,
      notes: null,
      progress: null,
      bytesPerSecond: null,
      error: null,
      releasesUrl: RELEASES_PAGE,
      checkedAt: null,
    };
    if (mode === 'installer') this.setupAutoUpdater();
    if (portableExe) this.cleanupOldPortable(portableExe);
  }

  get current(): UpdateState {
    return this.state;
  }

  check(): Promise<UpdateState> {
    if (this.state.mode === 'dev') return Promise.resolve(this.state);
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return Promise.resolve(this.state);
    return this.exclusive(async () => {
      this.set({ status: 'checking', error: null });
      try {
        if (this.state.mode === 'portable') await this.checkPortable();
        else await autoUpdater.checkForUpdates();
      } catch (err) {
        this.fail(err);
      }
      this.set({ checkedAt: new Date().toISOString() });
      return this.state;
    });
  }

  download(): Promise<UpdateState> {
    if (this.state.status !== 'available' && this.state.status !== 'error') return Promise.resolve(this.state);
    if (!this.state.version) return Promise.resolve(this.state);
    return this.exclusive(async () => {
      this.set({ status: 'downloading', progress: 0, error: null });
      try {
        if (this.state.mode === 'portable') await this.downloadPortable();
        else await autoUpdater.downloadUpdate();
      } catch (err) {
        this.fail(err);
      }
      return this.state;
    });
  }

  /** İndirilen güncellemeyi kurar ve uygulamayı yeniden başlatır. */
  async install(): Promise<boolean> {
    if (this.state.status !== 'downloaded') return false;
    if (this.state.mode === 'portable') return this.installPortable();
    // Sessiz kurulum, bitince uygulama yeniden açılır
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  // -------------------------------------------------------------------------
  // Kurulum sürümü (electron-updater)

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;
    if (FEED) {
      autoUpdater.forceDevUpdateConfig = !app.isPackaged;
      autoUpdater.setFeedURL({ provider: 'generic', url: FEED });
    }
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      this.set({ status: 'available', version: info.version, notes: notesOf(info) }),
    );
    autoUpdater.on('update-not-available', (info: UpdateInfo) =>
      this.set({ status: 'not-available', version: info.version, notes: null }),
    );
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      this.set({ status: 'downloading', progress: Math.round(p.percent), bytesPerSecond: Math.round(p.bytesPerSecond) }),
    );
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      this.set({ status: 'downloaded', version: info.version, progress: 100 }),
    );
    autoUpdater.on('error', (err: Error) => this.fail(err));
  }

  // -------------------------------------------------------------------------
  // Portable sürüm

  private async checkPortable(): Promise<void> {
    const res = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FlacSync-Updater' },
    });
    if (!res.ok) throw new Error(`GitHub yanıtı: HTTP ${res.status}`);
    const release = (await res.json()) as GitHubRelease;
    const version = release.tag_name.replace(/^v/, '');
    if (!isNewer(version, this.state.currentVersion)) {
      this.portableRelease = null;
      this.set({ status: 'not-available', version, notes: null });
      return;
    }
    const exe = release.assets.find((a) => a.name === `FlacSync-${version}.exe`);
    if (!exe) throw new Error('Yeni sürümde portable exe bulunamadı');
    const sums = release.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name));
    this.portableRelease = { version, exeUrl: exe.browser_download_url, sumsUrl: sums?.browser_download_url ?? null };
    this.set({ status: 'available', version, notes: release.body?.trim() || null });
  }

  private async downloadPortable(): Promise<void> {
    const release = this.portableRelease;
    const current = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!release || !current) throw new Error('Güncelleme bilgisi yok, önce kontrol edin');

    // Aynı klasöre indirilir: sonradan yeniden adlandırma (rename) sürücüler arası çalışmaz
    const target = `${current}.download`;
    const res = await fetch(release.exeUrl, { headers: { 'User-Agent': 'FlacSync-Updater' } });
    if (!res.ok || !res.body) throw new Error(`İndirme başarısız: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    const out = createWriteStream(target);
    const started = Date.now();
    let received = 0;
    let lastEmit = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        const now = Date.now();
        if (total && now - lastEmit > 250) {
          lastEmit = now;
          this.set({
            progress: Math.min(99, Math.round((received / total) * 100)),
            bytesPerSecond: Math.round(received / Math.max(0.001, (now - started) / 1000)),
          });
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      await rm(target, { force: true });
      throw err;
    }

    if (release.sumsUrl) {
      const sums = await (await fetch(release.sumsUrl, { headers: { 'User-Agent': 'FlacSync-Updater' } })).text();
      const expected = sums
        .split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/))
        .find(([, name]) => name === basename(new URL(release.exeUrl).pathname))?.[0];
      const actual = hash.digest('hex');
      if (!expected || expected.toLowerCase() !== actual) {
        await rm(target, { force: true });
        throw new Error('İndirilen dosyanın SHA-256 özeti tutmuyor; güncelleme iptal edildi');
      }
    }
    this.portableFile = target;
    this.set({ status: 'downloaded', progress: 100 });
  }

  private installPortable(): boolean {
    const current = process.env.PORTABLE_EXECUTABLE_FILE;
    const next = this.portableFile;
    if (!current || !next || !existsSync(next)) return false;
    // Uygulama ve portable başlatıcı kapanınca exe'nin kilidi kalkar; yardımcı o ana kadar (en çok 2 dk)
    // yarım saniyede bir taşımayı dener, başarınca yeni sürümü açar. Yardımcı, uygulamanın kendi exe'si
    // Node olarak çalıştırılarak koşar (ELECTRON_RUN_AS_NODE) — PowerShell ayrık süreçte çalışmıyor.
    const helper = [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      `const src = ${JSON.stringify(next)};`,
      `const dst = ${JSON.stringify(current)};`,
      'const env = Object.assign({}, process.env);',
      'delete env.ELECTRON_RUN_AS_NODE;',
      'let tries = 0;',
      'const timer = setInterval(() => {',
      '  try {',
      '    fs.renameSync(src, dst);',
      '    clearInterval(timer);',
      "    spawn(dst, [], { detached: true, stdio: 'ignore', env }).unref();",
      '    setTimeout(() => process.exit(0), 300);',
      '  } catch (e) {',
      '    if (++tries > 240) process.exit(1);',
      '  }',
      '}, 500);',
    ].join('\n');
    try {
      const child = spawn(process.execPath, ['-e', helper], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...ORIGINAL_ENV, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.unref();
    } catch (err) {
      this.fail(err);
      return false;
    }
    this.quit();
    return true;
  }

  /** Yarıda kalmış bir indirmeden kalan dosyayı siler. */
  private cleanupOldPortable(current: string): void {
    const leftover = `${current}.download`;
    if (existsSync(leftover)) setTimeout(() => void rm(leftover, { force: true }).catch(() => undefined), 5_000).unref();
  }

  // -------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) return this.busy as Promise<T>;
    const p = fn().finally(() => {
      this.busy = null;
    });
    this.busy = p;
    return p;
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    // electron-updater çok uzun yığın izleri döndürebiliyor
    this.set({ status: 'error', error: message.split('\n')[0]!.slice(0, 300), progress: null });
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.getWindow()?.webContents.send('flacsync:update-state', this.state);
  }
}

