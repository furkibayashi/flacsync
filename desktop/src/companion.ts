// Masaüstü yardımcıları: sistem tepsisi, mini oynatıcı penceresi ve pano izleme.
//
// Çalan şarkının durumu ana pencereden gelir ('flacsync:now-playing'); tepsi menüsü ve mini oynatıcı
// komutları ('flacsync:player-command') ana pencereye iletilir. Mini oynatıcı kendisi ses çalmaz.
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, Notification, screen, Tray } from 'electron';

export interface NowPlaying {
  title: string;
  artist: string;
  coverUrl: string | null;
  playing: boolean;
  time: number;
  duration: number;
}

export type PlayerCommand = 'toggle' | 'next' | 'prev';

interface DesktopPrefs {
  closeToTray: boolean;
  clipboardWatch: boolean;
}

/** Müzik linkleri (Spotify, Apple Music, Deezer, YouTube Music, Amazon Music) */
const MUSIC_LINK =
  /^(?:https?:\/\/)?(?:open\.spotify\.com|spotify\.link|(?:geo\.)?music\.apple\.com|(?:www\.)?deezer\.com|link\.deezer\.com|deezer\.page\.link|music\.youtube\.com|(?:www\.|m\.)?youtube\.com\/watch|youtu\.be|music\.amazon\.[a-z.]+)\/\S+$/i;

export function setupCompanion(options: {
  appName: string;
  url: string;
  iconPath: string;
  preload: string;
  getMainWindow: () => BrowserWindow | null;
}): void {
  const { appName, url, iconPath, preload, getMainWindow } = options;
  let nowPlaying: NowPlaying | null = null;
  let prefs: DesktopPrefs = { closeToTray: true, clipboardWatch: true };
  let quitting = false;
  let toldAboutTray = false;
  let mini: BrowserWindow | null = null;
  let tray: Tray | null = null;

  app.on('before-quit', () => {
    quitting = true;
  });

  const showMain = () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const command = (cmd: PlayerCommand) => getMainWindow()?.webContents.send('flacsync:player-command', cmd);

  // --- Tepsi ------------------------------------------------------------------------------------
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(appName);
  tray.on('click', showMain);

  const updateTray = () => {
    if (!tray) return;
    const np = nowPlaying;
    tray.setToolTip(np ? `${np.title} — ${np.artist}${np.playing ? '' : ' (duraklatıldı)'}` : appName);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(np
          ? [
              { label: `${np.title} — ${np.artist}`.slice(0, 60), enabled: false },
              { type: 'separator' as const },
              { label: np.playing ? 'Duraklat' : 'Çal', click: () => command('toggle') },
              { label: 'Sonraki', click: () => command('next') },
              { label: 'Önceki', click: () => command('prev') },
              { type: 'separator' as const },
            ]
          : []),
        { label: `${appName}'i göster`, click: showMain },
        { label: mini ? 'Mini oynatıcıyı kapat' : 'Mini oynatıcı', click: () => (mini ? mini.close() : openMini()) },
        { type: 'separator' },
        { label: 'Çıkış', click: () => app.quit() },
      ]),
    );
  };
  updateTray();

  // Pencere kapatılınca tepside çalmaya devam et
  const attachCloseToTray = (win: BrowserWindow) => {
    win.on('close', (e) => {
      if (quitting || !prefs.closeToTray) return;
      e.preventDefault();
      win.hide();
      if (!toldAboutTray && Notification.isSupported()) {
        toldAboutTray = true;
        new Notification({
          title: appName,
          body: 'Tepside çalışmaya devam ediyor. Tamamen kapatmak için tepsi simgesine sağ tıklayıp Çıkış’ı seçin.',
        }).show();
      }
    });
  };
  const waitForMain = setInterval(() => {
    const win = getMainWindow();
    if (!win) return;
    clearInterval(waitForMain);
    attachCloseToTray(win);
  }, 200);

  // --- Mini oynatıcı ------------------------------------------------------------------------------
  function openMini(): void {
    if (mini) {
      mini.show();
      mini.focus();
      return;
    }
    const area = screen.getPrimaryDisplay().workArea;
    const width = 380;
    const height = 128;
    mini = new BrowserWindow({
      width,
      height,
      x: area.x + area.width - width - 24,
      y: area.y + area.height - height - 24,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      title: `${appName} — Mini`,
      backgroundColor: '#17151f',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload },
    });
    mini.setAlwaysOnTop(true, 'floating');
    void mini.loadURL(`${url}/#/mini`);
    mini.on('closed', () => {
      mini = null;
      updateTray();
    });
    updateTray();
  }

  // --- Pano izleme ----------------------------------------------------------------------------------
  let lastClip = '';
  const readClip = async (): Promise<string> => {
    try {
      return String(await clipboard.readText()).trim();
    } catch {
      return '';
    }
  };
  void readClip().then((t) => (lastClip = t));
  setInterval(async () => {
    if (!prefs.clipboardWatch) return;
    const text = await readClip();
    if (!text || text === lastClip) return;
    lastClip = text;
    if (text.length > 500 || !MUSIC_LINK.test(text)) return;
    const win = getMainWindow();
    if (!win) return;
    const link = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    if (win.isVisible() && win.isFocused()) {
      win.webContents.send('flacsync:clipboard-link', link);
    } else if (Notification.isSupported()) {
      const n = new Notification({ title: 'Müzik linki kopyalandı', body: `${link}\nİndirmek için tıkla.` });
      n.on('click', () => {
        showMain();
        win.webContents.send('flacsync:clipboard-link', link);
      });
      n.show();
    }
  }, 1500).unref();

  // --- IPC ----------------------------------------------------------------------------------------
  ipcMain.on('flacsync:now-playing', (_e, state: unknown) => {
    nowPlaying = isNowPlaying(state) ? state : null;
    updateTray();
    mini?.webContents.send('flacsync:now-playing', nowPlaying);
  });
  ipcMain.handle('flacsync:get-now-playing', () => nowPlaying);
  ipcMain.on('flacsync:player-command', (_e, cmd: unknown) => {
    if (cmd === 'toggle' || cmd === 'next' || cmd === 'prev') command(cmd);
  });
  ipcMain.on('flacsync:mini', (_e, open: unknown) => (open ? openMini() : mini?.close()));
  ipcMain.on('flacsync:show-main', showMain);
  ipcMain.on('flacsync:desktop-prefs', (_e, next: unknown) => {
    if (typeof next !== 'object' || next === null) return;
    const p = next as Partial<DesktopPrefs>;
    const wasWatching = prefs.clipboardWatch;
    prefs = {
      closeToTray: typeof p.closeToTray === 'boolean' ? p.closeToTray : prefs.closeToTray,
      clipboardWatch: typeof p.clipboardWatch === 'boolean' ? p.clipboardWatch : prefs.clipboardWatch,
    };
    // Açılınca o an panoda olan link sorulmaz
    if (!wasWatching && prefs.clipboardWatch) void readClip().then((t) => (lastClip = t));
  });
}

function isNowPlaying(v: unknown): v is NowPlaying {
  if (typeof v !== 'object' || v === null) return false;
  const n = v as Record<string, unknown>;
  return typeof n.title === 'string' && typeof n.artist === 'string' && typeof n.playing === 'boolean';
}
