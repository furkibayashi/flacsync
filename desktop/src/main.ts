import { copyFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import dotenv from 'dotenv';
import { setupCompanion } from './companion.js';
import { dt, onDesktopLangChange, setDesktopLang, toDesktopLang } from './i18n.js';
import { LanShare } from './lan.js';
import { Updater } from './updater.js';
import { downloadHealth } from '../../backend/src/utils/download-errors.js';
import { ensureYtDlpDir, updateYtDlpDir } from './ytdlp-dir.js';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';

const APP_NAME = 'FlacSync';
const APP_ID = 'com.flacsync.desktop';
const PREFERRED_PORT = 47821;
const EXE = process.platform === 'win32' ? '.exe' : '';

const SETTINGS_TEMPLATE = `# FlacSync ayarları
# Değişikliklerden sonra menüden "Dosya > Yeniden başlat" seçin.
# Anahtarlar opsiyoneldir: boş bırakılırsa anahtarsız yöntemler (embed / iTunes / Deezer) kullanılır.

# Spotify Web API (https://developer.spotify.com/dashboard) — ISRC ve doğru albüm adı için
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_MARKET=TR

# Apple Music API (MusicKit .p8 anahtarı)
APPLE_MUSIC_TEAM_ID=
APPLE_MUSIC_KEY_ID=
APPLE_MUSIC_PRIVATE_KEY_PATH=
APPLE_MUSIC_STOREFRONT=tr

# Çıktı ayarları
MP3_BITRATE=320
FLAC_COMPRESSION_LEVEL=8
MAX_CONCURRENT_DOWNLOADS=3

# Odesli (song.link) API anahtarı — Amazon Music şarkı linkleri için (albüm linkleri anahtarsız çalışır)
ODESLI_API_KEY=

# Şarkı sözleri (LRCLib): indirilen dosyalara zaman damgalı sözler gömülür
LYRICS_ENABLED=true

# YouTube Premium çerezleri (Netscape cookies.txt) — 256 kbps AAC akışları için
YTDLP_COOKIES_FILE=

LOG_LEVEL=info
`;

// ---------------------------------------------------------------------------
// Yollar
// ---------------------------------------------------------------------------

/** Paketlenmiş uygulamada resources/, geliştirmede repo kökü. */
const resourceRoot = () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), '..'));

/** Ayarlar'dan seçilen indirme klasörü; okunamazsa / yoksa varsayılan kullanılır */
let customSaveDir: string | null | undefined;
function readCustomSaveDir(): string | null {
  try {
    const dir = (JSON.parse(readFileSync(join(app.getPath('userData'), 'save-dir.json'), 'utf8')) as { dir?: unknown }).dir;
    return typeof dir === 'string' && dir.length > 2 && existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

const paths = {
  get userData() {
    return app.getPath('userData');
  },
  get settingsFile() {
    return join(this.userData, 'settings.env');
  },
  get logFile() {
    return join(this.userData, 'logs', 'flacsync.log');
  },
  /** yt-dlp klasör sürümü; güncellenebilsin diye yazılabilir bir klasöre kopyalanır */
  get ytDlpDir() {
    return join(this.userData, 'bin', 'yt-dlp');
  },
  get ytDlp() {
    return join(this.ytDlpDir, `yt-dlp${EXE}`);
  },
  get bundledYtDlpDir() {
    return app.isPackaged ? join(resourceRoot(), 'bin', 'yt-dlp') : join(resourceRoot(), 'vendor', 'yt-dlp');
  },
  /** Tepsi simgesi */
  get icon() {
    return app.isPackaged ? join(resourceRoot(), 'icon.png') : join(app.getAppPath(), 'build', 'icon.png');
  },
  get savedIndex() {
    return join(this.userData, 'data', 'saved-files.json');
  },
  get ffmpeg() {
    return app.isPackaged
      ? join(resourceRoot(), 'bin', `ffmpeg${EXE}`)
      : join(resourceRoot(), 'node_modules', 'ffmpeg-static', `ffmpeg${EXE}`);
  },
  get frontend() {
    return app.isPackaged ? join(resourceRoot(), 'frontend') : join(resourceRoot(), 'frontend', 'dist');
  },
  /** LICENSE, üçüncü taraf bildirimleri ve FFmpeg lisansı */
  get licenses() {
    return app.isPackaged ? join(resourceRoot(), 'licenses') : resourceRoot();
  },
  /** Kullanıcının kaydedilen dosyaları: varsayılan İndirilenler\FlacSync, Ayarlar'dan değiştirilebilir */
  get saveDir() {
    customSaveDir ??= readCustomSaveDir();
    return customSaveDir || join(app.getPath('downloads'), APP_NAME);
  },
  /** Seçilen indirme klasörü (yeniden başlatınca geçerli olur) */
  get saveDirFile() {
    return join(app.getPath('userData'), 'save-dir.json');
  },
};

// ---------------------------------------------------------------------------
// Ortam ve sunucu
// ---------------------------------------------------------------------------

function configureEnvironment(): void {
  mkdirSync(join(paths.userData, 'bin'), { recursive: true });
  if (!existsSync(paths.settingsFile)) writeFileSync(paths.settingsFile, SETTINGS_TEMPLATE, 'utf8');

  ensureYtDlpDir(paths.bundledYtDlpDir, paths.ytDlpDir, app.getVersion());
  if (!existsSync(paths.ffmpeg)) throw new Error(`ffmpeg bulunamadı: ${paths.ffmpeg}`);
  if (!existsSync(paths.frontend)) throw new Error(`Arayüz dosyaları bulunamadı: ${paths.frontend}`);

  // Kullanıcı ayarları (API anahtarları vb.)
  dotenv.config({ path: paths.settingsFile, quiet: true, override: true });

  // Uygulamanın kendi yönettiği ayarlar — kullanıcı dosyası bunları ezemez
  Object.assign(process.env, {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'http://127.0.0.1',
    DOWNLOAD_DIR: join(paths.userData, 'cache', 'downloads'),
    DATA_DIR: join(paths.userData, 'data'),
    TEMP_DIR: join(app.getPath('temp'), APP_NAME),
    FILE_RETENTION_MINUTES: '30',
    YTDLP_PATH: paths.ytDlp,
    FFMPEG_PATH: paths.ffmpeg,
    FRONTEND_DIST: paths.frontend,
    // Kütüphane = kaydedilen dosyalar; kopya oluşturulmaz, kayıt bitince attach edilir
    LIBRARY_DIR: paths.saveDir,
    LIBRARY_COPY: 'false',
    // Kütüphaneye klasör ekleme / tercihler (yalnızca masaüstünde)
    LIBRARY_FOLDERS: 'true',
    LOG_FILE: paths.logFile,
    // Tek kullanıcılı yerel uygulama: istek sınırı pratikte kapalı
    RATE_LIMIT_MAX: '10000',
  });
}

async function startServer(): Promise<{ server: Server; url: string }> {
  // Ortam değişkenleri ayarlandıktan SONRA yüklenmeli (config/env.ts import anında okur)
  const [{ createApp }, { jobsService }, { historyService }, { libraryService }, { playlistService }, { followService }] =
    await Promise.all([
      import('../../backend/src/app.js'),
      import('../../backend/src/services/jobs.service.js'),
      import('../../backend/src/services/history.service.js'),
      import('../../backend/src/services/library.service.js'),
      import('../../backend/src/services/playlist.service.js'),
      import('../../backend/src/services/follow.service.js'),
    ]);
  const [{ syncService }] = await Promise.all([import('../../backend/src/services/sync.service.js')]);
  syncService.start();
  // Silinen dosyalar Geri Dönüşüm Kutusu'na gitsin
  libraryService.setTrashHandler((file) => shell.trashItem(file));
  flushHistory = () =>
    Promise.all([
      historyService.flush(),
      libraryService.flush(),
      playlistService.flush(),
      followService.flush(),
      syncService.flush(),
      jobsService.flush(),
      import('../../backend/src/services/prefs.service.js').then((m) => m.prefsService.flush()),
    ]).then(
      () => undefined,
    );
  attachToLibrary = (jobId, file) => void libraryService.attach(jobId, file);
  // Daha önce kaydedilmiş / elle eklenmiş dosyalar kütüphanede görünsün
  setTimeout(() => void libraryService.rescan().catch(() => undefined), 3_000).unref();

  // Sabit port: arayüzün kökeni (origin) aynı kalır, dil / format tercihleri yeniden açılışta korunur.
  // Port doluysa rastgele bir porta düşülür.
  const app = createApp();
  const listen = (port: number) =>
    new Promise<Server>((resolve, reject) => {
      const srv = app.listen(port, '127.0.0.1');
      srv.once('listening', () => resolve(srv));
      srv.once('error', reject);
    });
  const server = await listen(PREFERRED_PORT).catch(() => listen(0));
  // Önceki oturumda yarım kalan indirmeler kaldığı yerden devam eder
  jobsService.restore();
  void jobsService.sweepOrphans().catch(() => undefined);
  jobsService.startSweeper();
  watchYtDlpHealth(jobsService);

  lanShare = new LanShare(app);

  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

// ---------------------------------------------------------------------------
// Pencere
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
/** Kapanışta indirme geçmişini diske yazar (startServer sonrası atanır) */
let flushHistory: () => Promise<void> = async () => undefined;
/** Kaydedilen dosyayı kütüphaneye ekler (startServer sonrası atanır) */
let attachToLibrary: (jobId: string, file: string) => void = () => undefined;
let updater: Updater | null = null;
/** Wi-Fi ile telefona gönderme (Ayarlar'dan açılır) */
let lanShare: LanShare | null = null;

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 860,
    minWidth: 400,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: '#0b0b0c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: join(__dirname, 'preload.cjs'),
      // Tepsideyken de crossfade / söz zamanlaması aksamasın
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Dış linkler (YouTube Music vb.) varsayılan tarayıcıda açılır
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  });

  void win.loadURL(url);
  return win;
}

/** Aynı adda dosya varsa "Ad (1).mp3" şeklinde benzersiz yol üretir. */
function uniquePath(dir: string, fileName: string): string {
  const { name, ext } = parse(fileName);
  let candidate = join(dir, fileName);
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`);
  return candidate;
}

/**
 * Kaydedilen dosyalar için bildirim. Albüm indirirken art arda gelen kayıtlar
 * tek bildirimde toplanır ("14 dosya kaydedildi").
 */
const savedBuffer: string[] = [];
let savedTimer: NodeJS.Timeout | null = null;

function notifySaved(file: string): void {
  savedBuffer.push(file);
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    const files = savedBuffer.splice(0);
    savedTimer = null;
    if (!Notification.isSupported() || files.length === 0) return;
    const first = files[0]!;
    const dir = parse(first).dir;
    const n = new Notification({
      title: files.length === 1 ? dt('saved') : dt('savedMany', { n: files.length }),
      body: files.length === 1 ? `${parse(first).base}\n${dir}` : dir,
      silent: true,
    });
    n.on('click', () => (files.length === 1 ? shell.showItemInFolder(first) : void shell.openPath(dir)));
    n.show();
  }, 2500);
}

/** "?folder=Albüm Adı" parametresini güvenli bir alt klasör adına çevirir. */
function folderFromUrl(url: string): string | null {
  try {
    const raw = new URL(url).searchParams.get('folder');
    if (!raw) return null;
    const clean = raw
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120);
    return clean || null;
  } catch {
    return null;
  }
}

/**
 * Arayüzden tetiklenen indirmeler sorulmadan İndirilenler\FlacSync'e kaydedilir.
 * Albüm / çalma listesi parçaları "?folder=" ile kendi alt klasörlerine gider.
 */
/** İndirme işi → kaydedildiği dosya. Aynı iş ikinci kez kaydedilmez, mevcut dosya gösterilir. */
const savedByJob = new Map<string, string>();
const MAX_SAVED_INDEX = 2000;
let savedIndexTimer: NodeJS.Timeout | null = null;

/** Önceki oturumlarda kaydedilen dosyalar: ana sayfadaki "Klasörde göster" yeniden başlatmadan sonra da çalışsın. */
function loadSavedIndex(): void {
  try {
    const entries = JSON.parse(readFileSync(paths.savedIndex, 'utf8')) as Array<[string, string]>;
    for (const [jobId, file] of entries) if (JOB_ID.test(jobId)) savedByJob.set(jobId, file);
  } catch {
    // ilk açılış ya da bozuk dosya: boş başla
  }
}

function persistSavedIndex(): void {
  if (savedIndexTimer) clearTimeout(savedIndexTimer);
  savedIndexTimer = setTimeout(() => {
    const entries = [...savedByJob.entries()].slice(-MAX_SAVED_INDEX);
    mkdirSync(parse(paths.savedIndex).dir, { recursive: true });
    writeFileSync(paths.savedIndex, JSON.stringify(entries), 'utf8');
  }, 500);
}
const JOB_FILE_URL = /\/api\/download\/([0-9a-f-]{36})\/file/i;
const JOB_ID = /^[0-9a-f-]{36}$/i;

function setupDownloads(): void {
  session.defaultSession.on('will-download', (event, item) => {
    const jobId = JOB_FILE_URL.exec(item.getURL())?.[1];
    const existing = jobId ? savedByJob.get(jobId) : undefined;
    if (existing && existsSync(existing)) {
      // Kopya oluşturma; zaten kaydedilmiş dosyayı Gezgin'de göster
      event.preventDefault();
      shell.showItemInFolder(existing);
      return;
    }

    const folder = folderFromUrl(item.getURL());
    const dir = folder ? join(paths.saveDir, folder) : paths.saveDir;
    mkdirSync(dir, { recursive: true });
    const target = uniquePath(dir, item.getFilename());
    item.setSavePath(target);

    item.once('done', (_e, state) => {
      if (state === 'completed') {
        if (jobId) {
          savedByJob.set(jobId, target);
          persistSavedIndex();
          attachToLibrary(jobId, target);
        }
        notifySaved(target);
      } else if (state === 'interrupted' && mainWindow) {
        void dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: APP_NAME,
          message: 'Dosya kaydedilemedi',
          detail: target,
        });
      }
    });
  });
}

/** Arayüzün çağırabildiği iki işlem (preload.ts üzerinden). Girdiler doğrulanır. */
function setupIpc(): void {
  // Pencere yenilenirken biten indirmeler kaydedilmemiş kalmasın: arayüz hangilerinin eksik olduğunu sorar
  ipcMain.handle('flacsync:unsaved-jobs', (_e, ids: unknown) =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && JOB_ID.test(id) && !savedByJob.has(id)) : [],
  );

  ipcMain.handle('flacsync:reveal-file', (_e, jobId: unknown) => {
    const file = typeof jobId === 'string' && JOB_ID.test(jobId) ? savedByJob.get(jobId) : undefined;
    if (file && existsSync(file)) {
      shell.showItemInFolder(file);
      return true;
    }
    mkdirSync(paths.saveDir, { recursive: true });
    void shell.openPath(paths.saveDir);
    return false;
  });

  ipcMain.handle('flacsync:save-as', async (_e, jobId: unknown) => {
    const file = typeof jobId === 'string' && JOB_ID.test(jobId) ? savedByJob.get(jobId) : undefined;
    if (!file || !existsSync(file)) return null;
    const ext = parse(file).ext.replace('.', '');
    const options = {
      title: dt('saveAs'),
      defaultPath: file,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    if (result.filePath !== file) await copyFile(file, result.filePath);
    return result.filePath;
  });

  // --- Ayarlar sayfası ---
  ipcMain.handle('flacsync:app-info', () => ({
    version: app.getVersion(),
    updateMode: updater?.current.mode ?? 'dev',
    saveDir: paths.saveDir,
  }));
  ipcMain.handle('flacsync:open-location', async (_e, kind: unknown) => {
    const target =
      kind === 'settings' ? paths.settingsFile
      : kind === 'logs' ? paths.logFile
      : kind === 'licenses' ? paths.licenses
      : kind === 'library' ? paths.saveDir
      : null;
    if (!target) return;
    if (kind === 'library') mkdirSync(target, { recursive: true });
    await shell.openPath(target);
  });
  ipcMain.handle('flacsync:update-ytdlp', () =>
    updateYtDlpDir(paths.ytDlpDir, join(app.getPath('temp'), APP_NAME)).catch((err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
    })),
  );
  ipcMain.handle('flacsync:relaunch', () => relaunch());

  // --- Klasörler (Ayarlar → Kütüphane) ---
  /** Kütüphaneye eklenecek bir müzik klasörü seçtirir; yolu döndürür */
  ipcMain.handle('flacsync:pick-folder', async () => {
    const options = { properties: ['openDirectory' as const], title: dt('pickMusicFolder') };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  /** İndirilenlerin kaydedileceği klasörü değiştirir; yeniden başlatınca geçerli olur */
  ipcMain.handle('flacsync:choose-save-dir', async () => {
    const options = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: dt('downloadFolder'),
      defaultPath: paths.saveDir,
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    const chosen = result.canceled ? null : result.filePaths[0];
    if (!chosen || chosen.toLowerCase() === paths.saveDir.toLowerCase()) return null;
    try {
      // Yazılabilir mi? (ör. salt okunur sürücü, izin yok)
      const probe = join(chosen, `.flacsync-${process.pid}.tmp`);
      writeFileSync(probe, '');
      rmSync(probe, { force: true });
    } catch {
      return { error: 'Bu klasöre yazılamıyor; başka bir klasör seçin' };
    }
    const previous = paths.saveDir;
    writeFileSync(paths.saveDirFile, JSON.stringify({ dir: chosen }), 'utf8');
    // Eski klasördeki indirmeler kütüphanede kalsın: (iç içe değilse) müzik klasörü olarak eklenir
    try {
      const { prefsService } = await import('../../backend/src/services/prefs.service.js');
      const inside = (root: string, p: string) => {
        const rel = relative(root, p);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      };
      const nested = inside(previous, chosen) || inside(chosen, previous);
      // Yeni indirme klasörü zaten "eklenen klasör"se listeden çıkar (iki kez taranmasın)
      let folders = prefsService.get().folders.filter((f) => !inside(chosen, f) && !inside(f, chosen));
      const covered = folders.some((f) => inside(f, previous));
      if (!nested && !covered && existsSync(previous)) folders = [...folders.filter((f) => !inside(previous, f)), previous];
      prefsService.update({ folders });
      await prefsService.flush();
    } catch (err) {
      console.warn('Eski indirme klasörü kütüphaneye eklenemedi:', err);
    }
    return { path: chosen, restart: true };
  });
  ipcMain.handle('flacsync:lan', async (_e, enabled: unknown) => {
    if (!lanShare) return null;
    if (enabled === true) return lanShare.enable();
    if (enabled === false) return lanShare.disable();
    return lanShare.current;
  });

  // --- Uygulama güncellemesi ---
  ipcMain.handle('flacsync:update-get', () => updater?.current ?? null);
  ipcMain.handle('flacsync:update-check', () => updater?.check() ?? null);
  ipcMain.handle('flacsync:update-download', () => updater?.download() ?? null);
  ipcMain.handle('flacsync:update-install', () => updater?.install() ?? false);

  ipcMain.handle('flacsync:open-save-folder', async (_e, folder: unknown) => {
    const sub = typeof folder === 'string' ? folderFromUrl(`http://x/?folder=${encodeURIComponent(folder)}`) : null;
    const dir = sub ? join(paths.saveDir, sub) : paths.saveDir;
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });
}

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------

function relaunch(): void {
  // Portable exe'de kendini yeniden başlatmak için asıl exe yolu kullanılmalı
  const target = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(target ? { execPath: target } : undefined);
  void flushHistory().finally(() => app.exit(0));
}

async function updateYtDlp(): Promise<void> {
  const show = (options: Electron.MessageBoxOptions) =>
    mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
  try {
    const result = await updateYtDlpDir(paths.ytDlpDir, join(app.getPath('temp'), APP_NAME));
    await show({
      type: 'info',
      title: APP_NAME,
      message: result.updated ? 'yt-dlp güncellendi' : 'yt-dlp zaten güncel',
      detail: result.updated ? `${result.from} → ${result.to}` : `Sürüm: ${result.to}`,
    });
  } catch (err) {
    await show({
      type: 'error',
      title: APP_NAME,
      message: 'yt-dlp güncellenemedi',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// yt-dlp'yi kendiliğinden güncelleme
// ---------------------------------------------------------------------------

type JobsServiceLike = {
  snapshot(): { stats: { active: number } };
  resume(options?: { retryFailed?: boolean; codes?: string[] }): number;
  hold(): () => void;
  readonly running: number;
};

const YTDLP_AUTO_MIN_INTERVAL_MS = 6 * 60 * 60_000;
const YTDLP_WEEKLY_MS = 7 * 24 * 60 * 60_000;

/**
 * İndirmeler "yt-dlp eski" türü hatayla düşünce (YouTube değiştiğinde olur) ya da haftada bir:
 * çalışan indirmeler bitince yt-dlp sessizce güncellenir (SHA-256 doğrulamalı), o hatayla
 * başarısız olan indirmeler yeniden sıraya konur. Elle güncellemeye gerek kalmaz.
 */
function watchYtDlpHealth(jobs: JobsServiceLike): void {
  const stampFile = join(paths.userData, 'data', 'ytdlp-check.json');
  const lastCheck = (): number => {
    try {
      return Number((JSON.parse(readFileSync(stampFile, 'utf8')) as { at?: number }).at) || 0;
    } catch {
      return 0;
    }
  };
  let running = false;
  let lastAttempt = 0;

  const run = async (reason: 'failures' | 'weekly') => {
    if (running || Date.now() - lastAttempt < YTDLP_AUTO_MIN_INTERVAL_MS) return;
    running = true;
    lastAttempt = Date.now();
    // yt-dlp klasörü kullanımdayken değiştirilemez: yeni indirmeler bekletilir, çalışanların ve
    // arama / eşleştirme çağrılarının bitmesi beklenir (en çok 5 dk)
    const release = jobs.hold();
    try {
      // Geç yükleme: backend modülleri ortam değişkenleri ayarlandıktan sonra yüklenmeli (env içe aktarımda okunur)
      const { ytDlpBusy } = await import('../../backend/src/utils/ytdlp.js');
      const busy = () => jobs.running > 0 || ytDlpBusy() > 0;
      for (let i = 0; i < 60 && busy(); i++) await new Promise((r) => setTimeout(r, 5_000));
      if (busy()) {
        lastAttempt = Date.now() - YTDLP_AUTO_MIN_INTERVAL_MS + 10 * 60_000; // 10 dk sonra yeniden dene
        throw new Error('yt-dlp hâlâ kullanımda; güncelleme ertelendi');
      }
      const result = await updateYtDlpDir(paths.ytDlpDir, join(app.getPath('temp'), APP_NAME)).catch((err: NodeJS.ErrnoException) => {
        // Klasör kilitliyse (Windows) 6 saat beklemeden kısa süre sonra yeniden denenir
        if (err.code === 'EBUSY' || err.code === 'EPERM') lastAttempt = Date.now() - YTDLP_AUTO_MIN_INTERVAL_MS + 10 * 60_000;
        throw err;
      });
      mkdirSync(dirname(stampFile), { recursive: true });
      writeFileSync(stampFile, JSON.stringify({ at: Date.now(), version: result.to }), 'utf8');
      if (result.updated) {
        const retried = jobs.resume({ retryFailed: true, codes: ['YTDLP_OUTDATED', 'YTDLP_FORBIDDEN'] });
        if (Notification.isSupported()) {
          new Notification({
            title: APP_NAME,
            body: retried
              ? dt('ytdlpUpdatedRetry', { v: result.to, n: retried })
              : dt('ytdlpUpdated', { v: result.to }),
          }).show();
        }
      }
      console.info(`yt-dlp otomatik kontrol (${reason}): ${result.from} → ${result.to}`);
    } catch (err) {
      console.warn('yt-dlp otomatik güncellenemedi:', err);
    } finally {
      release();
      running = false;
    }
  };

  downloadHealth.on('outdated', () => void run('failures'));
  if (Date.now() - lastCheck() > YTDLP_WEEKLY_MS) setTimeout(() => void run('weekly'), 90_000).unref();
}

function showAbout(): void {
  const options = {
    type: 'info' as const,
    title: APP_NAME,
    message: `${APP_NAME} ${app.getVersion()}`,
    detail: [
      'Açık kaynak yazılım — MIT lisansı.',
      'Copyright © 2026 FlacSync contributors',
      '',
      'Paketle gelen FFmpeg (GPL-3.0), yt-dlp (Unlicense) ve Electron kendi lisanslarıyla dağıtılır.',
      'Ayrıntılar: Yardım → Lisanslar ve üçüncü taraf bildirimleri.',
    ].join('\n'),
  };
  if (mainWindow) void dialog.showMessageBox(mainWindow, options);
  else void dialog.showMessageBox(options);
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: dt('file'),
      submenu: [
        {
          label: dt('openSaved'),
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mkdirSync(paths.saveDir, { recursive: true });
            void shell.openPath(paths.saveDir);
          },
        },
        { type: 'separator' },
        { label: dt('settingsFile'), click: () => void shell.openPath(paths.settingsFile) },
        { label: dt('restart'), click: () => relaunch() },
        { type: 'separator' },
        { role: 'quit', label: dt('quit') },
      ],
    },
    {
      label: dt('tools'),
      submenu: [
        {
          label: dt('checkUpdates'),
          click: () => {
            mainWindow?.webContents.send('flacsync:navigate', 'settings');
            void updater?.check();
          },
        },
        { label: dt('settings'), accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('flacsync:navigate', 'settings') },
        { type: 'separator' },
        { label: dt('updateYtdlp'), click: () => void updateYtDlp() },
        { label: dt('openLog'), click: () => void shell.openPath(paths.logFile) },
        { type: 'separator' },
        { role: 'reload', label: dt('reload') },
        { role: 'toggleDevTools', label: dt('devtools') },
      ],
    },
    {
      label: dt('help'),
      submenu: [
        { label: dt('licenses'), click: () => void shell.openPath(paths.licenses) },
        { type: 'separator' },
        { label: dt('about', { app: APP_NAME, v: app.getVersion() }), click: showAbout },
      ],
    },
    {
      label: dt('view'),
      submenu: [
        { role: 'zoomIn', label: dt('zoomIn') },
        { role: 'zoomOut', label: dt('zoomOut') },
        { role: 'resetZoom', label: dt('resetZoom') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: dt('fullscreen') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    // Tepsideyse (gizli) geri getir
    mainWindow.show();
    mainWindow.focus();
  });

  let server: Server | null = null;

  app.whenReady().then(async () => {
    try {
      configureEnvironment();
      loadSavedIndex();
      const started = await startServer();
      server = started.server;
      // Arayüz dilini bildirene kadar işletim sisteminin dili; değişince menü yeniden kurulur
      setDesktopLang(toDesktopLang(app.getLocale()));
      buildMenu();
      onDesktopLangChange(() => buildMenu());
      setupDownloads();
      updater = new Updater(() => mainWindow, () => app.quit());
      setupIpc();
      mainWindow = createWindow(started.url);
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
      setupCompanion({
        appName: APP_NAME,
        url: started.url,
        iconPath: paths.icon,
        preload: join(__dirname, 'preload.cjs'),
        getMainWindow: () => mainWindow,
      });
    } catch (err) {
      console.error(`${APP_NAME} başlatılamadı:`, err);
      dialog.showErrorBox(`${APP_NAME} başlatılamadı`, err instanceof Error ? err.message : String(err));
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    server?.close();
    // app.quit() tekrar çağrılır (exit değil): electron-updater kurulumu 'quit' olayında başlatır
    void flushHistory().finally(() => app.quit());
  });
}
