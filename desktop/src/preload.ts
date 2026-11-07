// Arayüze yalnızca iki dar işlev açılır; Node.js / dosya sistemi erişimi verilmez.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flacsync', {
  isDesktop: true,
  /** İndirme işinin kaydedilen dosyasını Gezgin'de seçili gösterir */
  revealFile: (jobId: string): Promise<boolean> => ipcRenderer.invoke('flacsync:reveal-file', jobId),
  /** Windows "Farklı kaydet" penceresi; seçilen yeri döndürür (iptalde null) */
  saveAs: (jobId: string): Promise<string | null> => ipcRenderer.invoke('flacsync:save-as', jobId),
  /** Kayıt klasörünü (ya da albüm alt klasörünü) açar */
  openSaveFolder: (folder?: string): Promise<void> => ipcRenderer.invoke('flacsync:open-save-folder', folder),
});
