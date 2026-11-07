// Masaüstü uygulamasında preload betiğinin açtığı köprü (desktop/src/preload.ts)
export {};

declare global {
  type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported';

  interface DesktopUpdateState {
    status: UpdateStatus;
    mode: 'installer' | 'portable' | 'dev';
    currentVersion: string;
    version: string | null;
    notes: string | null;
    progress: number | null;
    bytesPerSecond: number | null;
    error: string | null;
    releasesUrl: string;
    checkedAt: string | null;
  }

  interface Window {
    flacsync?: {
      isDesktop: true;
      revealFile(jobId: string): Promise<boolean>;
      saveAs(jobId: string): Promise<string | null>;
      openSaveFolder(folder?: string): Promise<void>;
      appInfo(): Promise<{ version: string; updateMode: DesktopUpdateState['mode']; saveDir: string }>;
      openLocation(kind: 'settings' | 'logs' | 'licenses' | 'library'): Promise<void>;
      updateYtDlp(): Promise<{ updated: boolean; from: string; to: string } | { error: string }>;
      relaunch(): Promise<void>;
      update: {
        get(): Promise<DesktopUpdateState | null>;
        check(): Promise<DesktopUpdateState | null>;
        download(): Promise<DesktopUpdateState | null>;
        install(): Promise<boolean>;
        onState(listener: (state: DesktopUpdateState) => void): () => void;
      };
      onNavigate(listener: (page: string) => void): () => void;
    };
  }
}
