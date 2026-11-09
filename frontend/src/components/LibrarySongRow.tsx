import clsx from 'clsx';
import { Check, Disc3, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { formatDuration } from '../lib/format';
import { api } from '../services/api';
import { usePlayer, type PlayerTrack } from '../state/PlayerProvider';
import type { LibraryTrack } from '../types/api';
import { AddToPlaylist } from './AddToPlaylist';
import { ArtistLinks } from './ArtistLinks';
import { RowPlayButton } from './PlayButton';
import { Popover } from './Popover';

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
});

export function LibraryCover({ id, className }: { id: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={clsx('relative block shrink-0 overflow-hidden bg-raised', className)}>
      {!failed ? (
        <img src={api.libraryCoverUrl(id)} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <Disc3 className="absolute inset-0 m-auto size-1/2 text-fade" strokeWidth={1.25} />
      )}
    </span>
  );
}

/** Tür rozeti; tıklayınca düzenlenir (dosyanın etiketine de yazılır). */
function GenreChip({ track, knownGenres, onChange }: { track: LibraryTrack; knownGenres: string[]; onChange: (t: LibraryTrack) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(track.genre ?? '');
  const [saving, setSaving] = useState(false);
  const listId = `genres-${track.id}`;

  const save = async (close: () => void) => {
    setSaving(true);
    const result = await api.setGenre(track.id, value.trim() || null).catch(() => null);
    setSaving(false);
    if (result) onChange(result.track);
    close();
  };

  return (
    <Popover
      side="bottom"
      className="w-64 p-3"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setValue(track.genre ?? '');
            toggle();
          }}
          title={t('library.editGenre')}
          className="group/genre hidden max-w-36 shrink-0 items-center gap-1 truncate rounded-full bg-raised px-2.5 py-0.5 text-xs text-dust transition hover:text-paper xl:inline-flex"
        >
          <span className="truncate">{track.genre ?? t('library.noGenre')}</span>
          <Pencil className="size-3 shrink-0 opacity-0 transition group-hover/genre:opacity-100" />
        </button>
      )}
    >
      {(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(close);
          }}
          className="space-y-2"
        >
          <label className="block text-xs font-bold tracking-wide text-fade uppercase" htmlFor={`${listId}-input`}>
            {t('library.editGenre')}
          </label>
          <input
            id={`${listId}-input`}
            autoFocus
            list={listId}
            value={value}
            maxLength={60}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-full rounded-lg bg-night px-3 text-sm text-paper ring-1 ring-rule outline-none focus:ring-amber"
          />
          <datalist id={listId}>
            {knownGenres.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber py-2 text-sm font-bold text-on-accent disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t('library.saveGenre')}
          </button>
        </form>
      )}
    </Popover>
  );
}

export function LibrarySongRow({
  track,
  index,
  onPlay,
  onRemove,
  removeLabel,
  showAlbum,
  knownGenres,
  onChange,
}: {
  track: LibraryTrack;
  index: number;
  onPlay: () => void;
  /** Yoksa kaldırma düğmesi gösterilmez (akıllı listeler) */
  onRemove?: () => void;
  /** Kütüphaneden mi, listeden mi kaldırılacağı */
  removeLabel?: string;
  showAlbum: boolean;
  knownGenres: string[];
  onChange: (t: LibraryTrack) => void;
}) {
  const { current, playing } = usePlayer();
  const active = current?.id === `lib:${track.id}`;
  return (
    <li
      onDoubleClick={onPlay}
      className={clsx('group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised/60 sm:gap-4 sm:px-3', active && 'bg-raised/70')}
    >
      <span className="w-6 shrink-0 text-right text-sm text-fade tabular-nums">{track.trackNumber ?? index + 1}</span>
      <LibraryCover id={track.id} className="size-11 rounded-md" />
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate font-semibold', active ? 'text-amber' : 'text-paper')}>{track.title}</span>
        {track.artist ? (
          <ArtistLinks names={track.artist} className="block truncate text-sm text-dust" />
        ) : (
          <span className="block truncate text-sm text-dust">—</span>
        )}
      </span>
      {showAlbum && <span className="hidden min-w-0 flex-1 truncate text-sm text-fade lg:block">{track.album}</span>}
      <GenreChip track={track} knownGenres={knownGenres} onChange={onChange} />
      <span
        className={clsx(
          'hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase sm:block',
          track.format === 'flac' ? 'bg-flac/20 text-flac' : 'bg-amber/15 text-amber',
        )}
      >
        {track.format}
      </span>
      <span className="hidden w-12 shrink-0 text-right text-sm text-fade tabular-nums sm:block">{formatDuration(track.duration)}</span>
      <RowPlayButton active={active} playing={active && playing} onClick={onPlay} />
      <AddToPlaylist trackIds={[track.id]} side="bottom" className="opacity-60 group-hover:opacity-100" />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          title={removeLabel}
          aria-label={removeLabel}
          className="grid size-9 shrink-0 place-items-center rounded-full text-fade opacity-0 transition group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <span className="size-9 shrink-0" />
      )}
    </li>
  );
}
