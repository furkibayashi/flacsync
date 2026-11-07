import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { copyFile } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, parse } from 'node:path';
import dotenv from 'dotenv';
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

# YouTube Premium çerezleri (Netscape cookies.txt) — 256 kbps AAC akışları için
YTDLP_COOKIES_FILE=

LOG_LEVEL=info
`;

// ---------------------------------------------------------------------------
// Yollar
// ---------------------------------------------------------------------------

/** Paketlenmiş uygulamada resources/, geliştirmede repo kökü. */
const resourceRoot = () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), '..'));

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
  /** yt-dlp kendini güncelleyebilsin diye yazılabilir bir klasöre kopyalanır */
  get ytDlp() {
    return join(this.userData, 'bin', `yt-dlp${EXE}`);
  },
  get bundledYtDlp() {
    return app.isPackaged
      ? join(resourceRoot(), 'bin', `yt-dlp${EXE}`)
      : join(resourceRoot(), 'node_modules', 'yt-dlp-exec', 'bin', `yt-dlp${EXE}`);
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
  /** Kullanıcının kaydedilen dosyaları: İndirilenler\FlacSync */
  get saveDir() {
    return join(app.getPath('downloads'), APP_NAME);
  },
};

// ---------------------------------------------------------------------------
// Ortam ve sunucu
// ---------------------------------------------------------------------------

function configureEnvironment(): void {
  mkdirSync(join(paths.userData, 'bin'), { recursive: true });
  if (!existsSync(paths.settingsFile)) writeFileSync(paths.settingsFile, SETTINGS_TEMPLATE, 'utf8');

  if (!existsSync(paths.ytDlp)) copyFileSync(paths.bundledYtDlp, paths.ytDlp);
  if (!existsSync(paths.ffmpeg)) throw new Error(`ffmpeg bulunamadı: ${paths.ffmpeg}`);
  if (!existsSync(paths.frontend)) throw new Error(`Arayüz dosyaları bulunamadı: ${paths.frontend}`);

  // Kullanıcı ayarları (API anahtarları vb.)
  dotenv.config({ path: paths.settingsFile, quiet: true });

  // Uygulamanın kendi yönettiği ayarlar — kullanıcı dosyası bunları ezemez
  Object.assign(process.env, {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'http://127.0.0.1',
    DOWNLOAD_DIR: join(paths.userData, 'cache', 'downloads'),
    TEMP_DIR: join(app.getPath('temp'), APP_NAME),
    FILE_RETENTION_MINUTES: '30',
    YTDLP_PATH: paths.ytDlp,
    FFMPEG_PATH: paths.ffmpeg,
    FRONTEND_DIST: paths.frontend,
    LOG_FILE: paths.logFile,
    // Tek kullanıcılı yerel uygulama: istek sınırı pratikte kapalı
    RATE_LIMIT_MAX: '10000',
  });
}

async function startServer(): Promise<{ server: Server; url: string }> {
  // Ortam değişkenleri ayarlandıktan SONRA yüklenmeli (config/env.ts import anında okur)
  const [{ createApp }, { jobsService }] = await Promise.all([
    import('../../backend/src/app.js'),
    import('../../backend/src/services/jobs.service.js'),
  ]);

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  jobsService.startSweeper();

  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

// ---------------------------------------------------------------------------
// Pencere
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

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
      title: files.length === 1 ? 'Kaydedildi' : `${files.length} dosya kaydedildi`,
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
        if (jobId) savedByJob.set(jobId, target);
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
      title: 'Farklı kaydet',
      defaultPath: file,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    if (result.filePath !== file) await copyFile(file, result.filePath);
    return result.filePath;
  });

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
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(portableExe ? { execPath: portableExe } : undefined);
  app.exit(0);
}

function updateYtDlp(): void {
  execFile(paths.ytDlp, ['-U'], { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
    const output = `${stdout}\n${stderr}`.trim().split(/\r?\n/).slice(-6).join('\n');
    const options = {
      type: err ? ('error' as const) : ('info' as const),
      title: APP_NAME,
      message: err ? "yt-dlp güncellenemedi" : "yt-dlp güncelleme kontrolü tamamlandı",
      detail: output || (err?.message ?? ''),
    };
    if (mainWindow) void dialog.showMessageBox(mainWindow, options);
    else void dialog.showMessageBox(options);
  });
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
      label: 'Dosya',
      submenu: [
        {
          label: 'Kaydedilenler klasörünü aç',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mkdirSync(paths.saveDir, { recursive: true });
            void shell.openPath(paths.saveDir);
          },
        },
        { type: 'separator' },
        { label: 'Ayarlar ve API anahtarları…', click: () => void shell.openPath(paths.settingsFile) },
        { label: 'Yeniden başlat (ayarları uygula)', click: relaunch },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    {
      label: 'Araçlar',
      submenu: [
        { label: "yt-dlp'yi güncelle", click: updateYtDlp },
        { label: 'Log dosyasını aç', click: () => void shell.openPath(paths.logFile) },
        { type: 'separator' },
        { role: 'reload', label: 'Sayfayı yenile' },
        { role: 'toggleDevTools', label: 'Geliştirici araçları' },
      ],
    },
    {
      label: 'Yardım',
      submenu: [
        { label: 'Lisanslar ve üçüncü taraf bildirimleri', click: () => void shell.openPath(paths.licenses) },
        { type: 'separator' },
        { label: `${APP_NAME} ${app.getVersion()} hakkında`, click: showAbout },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { role: 'resetZoom', label: 'Varsayılan boyut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam ekran' },
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
    mainWindow.focus();
  });

  let server: Server | null = null;

  app.whenReady().then(async () => {
    try {
      configureEnvironment();
      const started = await startServer();
      server = started.server;
      buildMenu();
      setupDownloads();
      setupIpc();
      mainWindow = createWindow(started.url);
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    } catch (err) {
      console.error(`${APP_NAME} başlatılamadı:`, err);
      dialog.showErrorBox(`${APP_NAME} başlatılamadı`, err instanceof Error ? err.message : String(err));
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
}
