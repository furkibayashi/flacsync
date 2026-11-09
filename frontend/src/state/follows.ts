import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../services/api';
import type { FollowedArtist } from '../types/api';

/** Takip edilen sanatçılar (tek kaynak; profil ve ana sayfa birlikte güncellenir) */
let artists: FollowedArtist[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: FollowedArtist[]) {
  artists = next;
  loaded = true;
  listeners.forEach((l) => l());
}

const reload = () =>
  api
    .follows()
    .then((r) => emit(r.artists))
    .catch(() => undefined);

export function useFollows() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => artists,
    () => artists,
  );
  useEffect(() => {
    if (!loaded) void reload();
  }, []);

  const isFollowing = useCallback((id: string) => list.some((a) => a.id === id), [list]);

  const toggle = useCallback(
    async (artist: { id: string; name: string; pictureUrl: string | null }) => {
      if (artists.some((a) => a.id === artist.id)) {
        emit(artists.filter((a) => a.id !== artist.id));
        await api.unfollow(artist.id).catch(() => undefined);
      } else {
        emit([...artists, { ...artist, followedAt: new Date().toISOString() }]);
        await api.follow(artist).catch(() => undefined);
      }
      void reload();
    },
    [],
  );

  return { artists: list, loaded, isFollowing, toggle };
}
