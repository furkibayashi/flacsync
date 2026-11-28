import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../services/api';
import { toast } from './toast';

/**
 * Sevilen şarkılar (kalp) tek yerde tutulur: kütüphane satırı, oynatıcı çubuğu ve
 * "Şimdi çalıyor" ekranı aynı durumu görür. Değişiklik hemen gösterilir, sunucu
 * reddederse geri alınır.
 */
let liked: ReadonlySet<string> = new Set();
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ReadonlySet<string>) {
  liked = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadLikes(): Promise<void> {
  inflight ??= api
    .likedIds()
    .then((r) => {
      loaded = true;
      emit(new Set(r.ids));
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Tüm sevilen şarkı kimlikleri (akıllı liste için) */
export function useLikedSet(): ReadonlySet<string> {
  const set = useSyncExternalStore(subscribe, () => liked, () => liked);
  useEffect(() => {
    if (!loaded) void loadLikes();
  }, []);
  return set;
}

/** Tek şarkı sevilenlerde mi? (libraryId yoksa — ör. önizleme — her zaman false) */
export function useIsLiked(libraryId: string | undefined): boolean {
  const set = useLikedSet();
  return libraryId ? set.has(libraryId) : false;
}

function apply(ids: string[], value: boolean): ReadonlySet<string> {
  const prev = liked;
  const next = new Set(liked);
  for (const id of ids) {
    if (value) next.add(id);
    else next.delete(id);
  }
  emit(next);
  return prev;
}

export async function setLiked(libraryId: string, value: boolean, errorText: string): Promise<void> {
  const prev = apply([libraryId], value);
  try {
    await api.setLiked(libraryId, value);
  } catch {
    emit(prev);
    toast({ message: errorText, kind: 'error' });
  }
}

export async function setLikedMany(ids: string[], value: boolean, errorText: string): Promise<void> {
  if (!ids.length) return;
  const prev = apply(ids, value);
  try {
    await api.setLikedMany(ids, value);
  } catch {
    emit(prev);
    toast({ message: errorText, kind: 'error' });
  }
}
