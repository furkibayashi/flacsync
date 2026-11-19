import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { PlayerTrack } from './PlayerProvider';
import { useQueue } from './QueueProvider';

/**
 * "Bu şarkı zaten kütüphanende mi?" Arama, albüm, sanatçı ve keşfet ekranları sorar; sonuçlar
 * önbellekte tutulur, yeni bir indirme bitince önbellek tazelenir.
 */
const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();
const keyOf = (artist: string, title: string) => `${artist.toLowerCase()}\u0000${title.toLowerCase()}`;

export function invalidateLibraryMatch(): void {
  cache.clear();
  listeners.forEach((l) => l());
}

async function fetchMissing(items: Array<{ artist: string; title: string }>): Promise<void> {
  const missing = items.filter((i) => !cache.has(keyOf(i.artist, i.title)));
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500);
    const { ids } = await api.matchLibrary(chunk);
    chunk.forEach((it, j) => cache.set(keyOf(it.artist, it.title), ids[j] ?? null));
  }
}

/** Verilen şarkılar için kütüphane kimliği bulucu: `idFor(artist, title)` → kimlik ya da null */
export function useLibraryMatch(items: Array<{ artist: string; title: string }>): (artist: string, title: string) => string | null {
  const [tick, setTick] = useState(0);
  const { stats } = useQueue();
  const signature = useMemo(() => items.map((i) => keyOf(i.artist, i.title)).join('\n'), [items]);

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  // Yeni indirme kütüphaneye girince (masaüstünde kayıt biraz sonra biter) yeniden sor
  useEffect(() => {
    if (!stats.completed) return;
    const t = setTimeout(invalidateLibraryMatch, 1500);
    return () => clearTimeout(t);
  }, [stats.completed]);

  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    void fetchMissing(items)
      .then(() => alive && setTick((n) => n + 1))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // items içeriği signature ile izlenir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cache.size === 0]);

  // Sonuç gelince (tick) değişir; arada sabit kalır ki useMemo bağımlılıkları her çizimde bozulmasın
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((artist: string, title: string) => cache.get(keyOf(artist, title)) ?? null, [tick]);
}

/** Kütüphanedeki dosyayı tam uzunlukta çalan oynatıcı parçası */
export function libraryPlayerTrack(id: string, info: { title: string; artist: string; album?: string | null; duration?: number | null }): PlayerTrack {
  return {
    id: `lib:${id}`,
    title: info.title,
    artist: info.artist,
    album: info.album ?? null,
    coverUrl: api.libraryCoverUrl(id),
    src: api.libraryStreamUrl(id),
    kind: 'full',
    duration: info.duration ?? null,
    libraryId: id,
  };
}
