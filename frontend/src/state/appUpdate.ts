import { useEffect, useSyncExternalStore } from 'react';

/**
 * Masaüstü uygulama güncellemesi durumu (preload köprüsü üzerinden).
 * Tarayıcıda / web sürümünde köprü yoktur → durum hep null.
 */
let state: DesktopUpdateState | null = null;
const listeners = new Set<() => void>();
let started = false;

function emit(next: DesktopUpdateState | null) {
  state = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started || !window.flacsync?.update) return;
  started = true;
  window.flacsync.update.onState(emit);
  void window.flacsync.update.get().then((s) => s && emit(s));
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const updateActions = {
  check: () => window.flacsync?.update.check().then((s) => s && emit(s)),
  download: () => window.flacsync?.update.download().then((s) => s && emit(s)),
  install: () => window.flacsync?.update.install(),
};

export function useAppUpdate(): DesktopUpdateState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

/** Açılıştan kısa süre sonra bir kez denetler (Ayarlar'dan kapatılabilir). */
export function useStartupUpdateCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !window.flacsync?.update) return;
    const timer = setTimeout(() => {
      void window.flacsync!.update.get().then((s) => {
        if (s && s.status === 'idle') void updateActions.check();
      });
    }, 6_000);
    return () => clearTimeout(timer);
  }, [enabled]);
}
