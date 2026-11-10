// Arayüze yalnızca dar, doğrulanan işlevler açılır; Node.js / dosya sistemi erişimi verilmez.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('flacsync', {
  isDesktop: true,
  /** İndirme işinin kaydedilen dosyasını Gezgin'de seçili gösterir */
  revealFile: (jobId: string): Promise<boolean> => ipcRenderer.invoke('flacsync:reveal-file', jobId),
  /** Windows "Farklı kaydet" penceresi; seçilen yeri döndürür (iptalde null) */
  saveAs: (jobId: string): Promise<string | null> => ipcRenderer.invoke('flacsync:save-as', jobId),
  /** Kayıt klasörünü (ya da albüm alt klasörünü) açar */
  openSaveFolder: (folder?: string): Promise<void> => ipcRenderer.invoke('flacsync:open-save-folder', folder),

  /** Sürüm, güncelleme türü, kayıt klasörü */
  appInfo: () => ipcRenderer.invoke('flacsync:app-info'),
  /** 'settings' | 'logs' | 'licenses' | 'library' */
  openLocation: (kind: string): Promise<void> => ipcRenderer.invoke('flacsync:open-location', kind),
  updateYtDlp: () => ipcRenderer.invoke('flacsync:update-ytdlp'),
  relaunch: (): Promise<void> => ipcRenderer.invoke('flacsync:relaunch'),

  update: {
    get: () => ipcRenderer.invoke('flacsync:update-get'),
    check: () => ipcRenderer.invoke('flacsync:update-check'),
    download: () => ipcRenderer.invoke('flacsync:update-download'),
    install: (): Promise<boolean> => ipcRenderer.invoke('flacsync:update-install'),
    onState: (listener: (state: unknown) => void) => subscribe('flacsync:update-state', listener),
  },
  // --- Tepsi, mini oynatıcı, pano ---
  /** Ana pencere: çalan şarkının durumunu bildirir (tepsi ve mini oynatıcı için) */
  sendNowPlaying: (state: unknown) => ipcRenderer.send('flacsync:now-playing', state),
  /** Ana pencere: tepsi / mini oynatıcıdan gelen komutlar */
  onPlayerCommand: (listener: (cmd: string) => void) => subscribe('flacsync:player-command', listener),
  /** Mini oynatıcı: komut gönder */
  playerCommand: (cmd: 'toggle' | 'next' | 'prev') => ipcRenderer.send('flacsync:player-command', cmd),
  getNowPlaying: () => ipcRenderer.invoke('flacsync:get-now-playing'),
  onNowPlaying: (listener: (state: unknown) => void) => subscribe('flacsync:now-playing', listener),
  setMiniPlayer: (open: boolean) => ipcRenderer.send('flacsync:mini', open),
  showMain: () => ipcRenderer.send('flacsync:show-main'),
  setDesktopPrefs: (prefs: { closeToTray?: boolean; clipboardWatch?: boolean }) => ipcRenderer.send('flacsync:desktop-prefs', prefs),
  onClipboardLink: (listener: (url: string) => void) => subscribe('flacsync:clipboard-link', listener),
  /** Wi-Fi ile telefona gönderme: true aç, false kapat, undefined durum */
  lan: (enabled?: boolean) => ipcRenderer.invoke('flacsync:lan', enabled),

  /** Menüden sayfa açma (ör. "Güncellemeleri denetle" → ayarlar) */
  onNavigate: (listener: (page: string) => void) => subscribe('flacsync:navigate', listener),
});
