import { useSyncExternalStore } from 'react';

/**
 * Şarkı başına söz zamanlaması kaydırması (ms). LRCLib sözleri bazen kayda göre biraz erken ya da
 * geç gelir; kullanıcı ±0,25 sn adımlarla düzeltir, bu cihazda şarkı için hatırlanır.
 * Pozitif değer: sözler daha geç gösterilir.
 */
const STORAGE_KEY = 'flacsync.lyricsOffset';
const MAX_ENTRIES = 500;
export const LYRICS_OFFSET_STEP_MS = 250;
export const LYRICS_OFFSET_LIMIT_MS = 10_000;

let offsets: Record<string, number> = read();
const listeners = new Set<() => void>();

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(offsets));
  } catch {
    // gizli pencere / dolu depolama: yalnızca bu oturumda geçerli
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clampOffset(ms: number): number {
  const rounded = Math.round(ms / 50) * 50;
  return Math.max(-LYRICS_OFFSET_LIMIT_MS, Math.min(LYRICS_OFFSET_LIMIT_MS, rounded));
}

export function setLyricsOffset(trackKey: string, ms: number): void {
  const value = clampOffset(ms);
  const next = { ...offsets };
  delete next[trackKey];
  // En son değiştirilen sona: sınır aşılınca en eskiler düşer
  if (value !== 0) next[trackKey] = value;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[k];
  offsets = next;
  persist();
  listeners.forEach((l) => l());
}

/** Çalan şarkının söz kaydırması; trackKey yoksa 0 */
export function useLyricsOffset(trackKey: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => (trackKey ? offsets[trackKey] ?? 0 : 0),
    () => 0,
  );
}
