// Masaüstü uygulamasında preload betiğinin açtığı köprü (desktop/src/preload.ts)
export {};

declare global {
  interface Window {
    flacsync?: {
      isDesktop: true;
      revealFile(jobId: string): Promise<boolean>;
      saveAs(jobId: string): Promise<string | null>;
      openSaveFolder(folder?: string): Promise<void>;
    };
  }
}
