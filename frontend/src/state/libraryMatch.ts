import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { PlayerTrack } from './PlayerProvider';
import { useQueue } from './QueueProvider';

/**
 * "Bu şarkı zaten kütüphanende mi?" Arama, albüm, sanatçı ve keşfet ekranları sorar; sonuçlar
 * önbellekte tutulur, yeni bir indirme bitince önbellek tazelenir. Süre de gönderilir ki aynı
 * sanatçının farklı albümlerdeki "Intro"su "zaten var" sayılmasın.
 */
type MatchItem = { artist: string; title: string; duration?: number | null };

const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();
/** Önbellek her temizlendiğinde artar; temizlikten önce başlamış istekler sonucunu yazmaz */
let generation = 0;
const keyOf = (artist: string, title: string, duration?: number | null) =>
  [artist.toLowerCase(), title.toLowerCase(), duration ? String(Math.round(duration)) : ''].join('\u0000');

export function invalidateLibraryMatch(): void {
  generation++;
  cache.clear();
  listeners.forEach((l) => l());
}

async function fetchMissing(items: MatchItem[]): Promise<void> {
  const gen = generation;
  const missing = items.filter((i) => !cache.has(keyOf(i.artist, i.title, i.duration)));
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500).map((m) => ({ artist: m.artist, title: m.title, duration: m.duration ?? null }));
    const { ids } = await api.matchLibrary(chunk);
    if (gen !== generation) return;
    chunk.forEach((it, j) => cache.set(keyOf(it.artist, it.title, it.duration), ids[j] ?? null));
  }
}

/** Verilen şarkılar için kütüphane kimliği bulucu: `idFor(artist, title, duration)` → kimlik ya da null */
export function useLibraryMatch(items: MatchItem[]): (artist: string, title: string, duration?: number | null) => string | null {
  const [tick, setTick] = useState(0);
  const { stats } = useQueue();
  const signature = useMemo(() => items.map((i) => keyOf(i.artist, i.title, i.duration)).join('\n'), [items]);

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
    // items içeriği signature ile izlenir; önbellek temizlenince (tick) eksikler yeniden sorulur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cache.size === 0]);

  // Sonuç gelince (tick) değişir; arada sabit kalır ki useMemo bağımlılıkları her çizimde bozulmasın
  return useCallback(
    (artist: string, title: string, duration?: number | null) => cache.get(keyOf(artist, title, duration)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );
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
