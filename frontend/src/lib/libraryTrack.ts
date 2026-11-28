import { api } from '../services/api';
import type { PlayerTrack } from '../state/PlayerProvider';
import type { LibraryTrack } from '../types/api';

/** Kütüphane şarkısı → oynatıcı parçası */
export const toPlayerTrack = (t: LibraryTrack): PlayerTrack => ({
  id: `lib:${t.id}`,
  title: t.title,
  artist: t.artist,
  album: t.album,
  coverUrl: api.libraryCoverUrl(t.id),
  src: api.libraryStreamUrl(t.id),
  kind: 'full',
  duration: t.duration,
  libraryId: t.id,
  loudness: t.loudness ?? null,
});
