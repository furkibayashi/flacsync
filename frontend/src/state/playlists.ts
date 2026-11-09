import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../services/api';
import type { Playlist } from '../types/api';

/** Çalma listeleri tek yerde tutulur; bir menüde liste oluşturulunca her ekran güncellenir. */
let playlists: Playlist[] = [];
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Playlist[]) {
  playlists = next;
  loaded = true;
  listeners.forEach((l) => l());
}

export function reloadPlaylists(): Promise<void> {
  inflight ??= api
    .playlists()
    .then((r) => emit(r.playlists))
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlaylists(): { playlists: Playlist[]; loaded: boolean; reload: () => void } {
  const list = useSyncExternalStore(subscribe, () => playlists, () => playlists);
  useEffect(() => {
    if (!loaded) void reloadPlaylists();
  }, []);
  const reload = useCallback(() => void reloadPlaylists(), []);
  return { playlists: list, loaded, reload };
}
