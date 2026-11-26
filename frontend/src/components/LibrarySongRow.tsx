import clsx from 'clsx';
import { AlertTriangle, Check, Disc3, Download, FilePenLine, ListEnd, ListStart, Loader2, MoreHorizontal, Pencil, Replace, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { formatDuration } from '../lib/format';
import { api } from '../services/api';
import { usePlayer, type PlayerTrack } from '../state/PlayerProvider';
import type { LibraryTrack } from '../types/api';
import { AddToPlaylist } from './AddToPlaylist';
import { ArtistLinks } from './ArtistLinks';
import { RowPlayButton } from './PlayButton';
import { TagEditor } from './TagEditor';
import { MenuItem, Popover } from './Popover';
import { RematchDialog } from './RematchDialog';
import { needsReview } from '../lib/match';

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
            className="h-9 w-full rounded-lg bg-night px-3 text-sm text-paper ring-1 ring-rule-strong outline-none focus:ring-amber"
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
  confirmRemove = false,
  selectable = false,
  selected = false,
  onSelect,
  reviewing = false,
}: {
  track: LibraryTrack;
  index: number;
  onPlay: () => void;
  /** Yoksa kaldırma seçeneği gösterilmez (akıllı listeler) */
  onRemove?: () => void;
  /** Kütüphaneden mi, listeden mi kaldırılacağı */
  removeLabel?: string;
  showAlbum: boolean;
  knownGenres: string[];
  onChange: (t: LibraryTrack) => void;
  /** Silmeden önce ikinci bir tıklama ister (dosya diskten kalkar) */
  confirmRemove?: boolean;
  /** Seçim kipi: numara yerine onay kutusu, satıra tıklamak seçer (Shift ile aralık) */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (range: boolean) => void;
  /** Eşleşme kontrolü: satırda "Doğru" / "Başka kayıt" düğmeleri */
  reviewing?: boolean;
}) {
  const { t } = useI18n();
  const player = usePlayer();
  const { current, playing } = player;
  const [editing, setEditing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [armed, setArmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Menüden açılan pencere kapanınca odak "⋯" düğmesine döner (menü öğesi o arada kaybolur) */
  const moreRef = useRef<HTMLButtonElement>(null);
  const returnFocus = () => setTimeout(() => moreRef.current?.focus(), 0);
  const active = current?.id === `lib:${track.id}`;
  const weak = needsReview(track.source);
  const scorePct = track.source?.score !== null && track.source?.score !== undefined ? Math.round(track.source.score * 100) : null;

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const confirmMatch = async () => {
    setConfirming(true);
    try {
      const { track: updated } = await api.confirmMatch(track.id);
      onChange(updated);
    } catch {
      // ağ hatası: satır olduğu gibi kalır, kullanıcı yeniden dener
    } finally {
      setConfirming(false);
    }
  };

  return (
    <li
      onDoubleClick={selectable ? undefined : onPlay}
      onClick={
        selectable
          ? (e) => {
              if ((e.target as HTMLElement).closest('button, a, input, select, dialog, [role="dialog"], [role="menu"]')) return;
              onSelect?.(e.shiftKey);
            }
          : undefined
      }
      className={clsx(
        'group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised/60 sm:gap-4 sm:px-3',
        active && 'bg-raised/70',
        selectable && 'cursor-pointer select-none',
        selected && 'bg-amber/10 ring-1 ring-amber/30',
      )}
    >
      {selectable ? (
        <span className="grid w-6 shrink-0 place-items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => undefined}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(e.shiftKey);
            }}
            aria-label={track.title}
            className="size-4 accent-[var(--color-amber)]"
          />
        </span>
      ) : (
        <span className="w-6 shrink-0 text-right text-sm text-fade tabular-nums">{showAlbum ? index + 1 : track.trackNumber ?? index + 1}</span>
      )}
      <LibraryCover id={track.id} className="size-11 rounded-md" />
      <span className="min-w-0 flex-1">
        <span className={clsx('flex items-center gap-1.5 font-semibold', active ? 'text-amber' : 'text-paper')}>
          <span className="truncate">{track.title}</span>
          {weak && (
            <span title={t('review.lowConfidence', { score: scorePct ?? 0 })} className="shrink-0 text-amber">
              <AlertTriangle aria-hidden className="size-3.5" />
              <span className="sr-only">{t('review.lowConfidence', { score: scorePct ?? 0 })}</span>
            </span>
          )}
        </span>
        {track.artist ? (
          <ArtistLinks names={track.artist} className="block truncate text-sm text-dust" />
        ) : (
          <span className="block truncate text-sm text-dust">—</span>
        )}
      </span>
      {reviewing && window.flacsync ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void confirmMatch()}
            disabled={confirming}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ok ring-1 ring-ok/40 transition hover:bg-ok/10 disabled:opacity-50"
          >
            {confirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            <span className="hidden sm:inline">{t('review.ok')}</span>
          </button>
          <button
            type="button"
            onClick={() => setRematching(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-paper ring-1 ring-rule-strong transition hover:ring-dust"
          >
            <Replace className="size-4" />
            <span className="hidden sm:inline">{t('review.other')}</span>
          </button>
        </span>
      ) : (
        <>
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
        </>
      )}
      <RowPlayButton active={active} playing={active && playing} onClick={onPlay} />
      {/* Telefondan / tarayıcıdan açıldıysa: dosyayı bu cihaza indir */}
      {!window.flacsync && (
        <a
          href={`${api.libraryStreamUrl(track.id)}?download=1`}
          download
          onClick={(e) => e.stopPropagation()}
          title={t('phone.download')}
          aria-label={t('phone.download')}
          className="grid size-9 shrink-0 place-items-center rounded-full text-dust transition hover:bg-raised hover:text-paper"
        >
          <Download className="size-4" />
        </a>
      )}
      <AddToPlaylist trackIds={[track.id]} side="bottom" className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
      <Popover
        side="bottom"
        label={t('library.more')}
        trigger={({ toggle, open }) => (
          <button
            ref={moreRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            aria-haspopup="menu"
            aria-expanded={open}
            title={t('library.more')}
            aria-label={`${t('library.more')}: ${track.title}`}
            className={clsx(
              'grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-raised',
              open || armed ? 'text-paper' : 'text-dust hover:text-paper',
            )}
          >
            <MoreHorizontal className="size-5" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<ListStart className="size-4 text-amber" />}
              onClick={() => {
                player.playNext([toPlayerTrack(track)]);
                close();
              }}
            >
              {t('player.playNext')}
            </MenuItem>
            <MenuItem
              icon={<ListEnd className="size-4 text-amber" />}
              onClick={() => {
                player.addToQueue([toPlayerTrack(track)]);
                close();
              }}
            >
              {t('player.addToQueue')}
            </MenuItem>
            {window.flacsync && (
              <>
                <span className="my-1 block h-px bg-rule" />
                <MenuItem
                  icon={<FilePenLine className="size-4" />}
                  onClick={() => {
                    close();
                    setEditing(true);
                  }}
                >
                  {t('tags.title')}
                </MenuItem>
                <MenuItem
                  icon={<Replace className="size-4" />}
                  onClick={() => {
                    close();
                    setRematching(true);
                  }}
                >
                  {t('rematch.menu')}
                </MenuItem>
              </>
            )}
            {onRemove && (
              <>
                <span className="my-1 block h-px bg-rule" />
                <MenuItem
                  danger
                  icon={<Trash2 className="size-4" />}
                  onClick={() => {
                    if (confirmRemove && !armed) return setArmed(true);
                    setArmed(false);
                    close();
                    onRemove();
                  }}
                >
                  {armed ? t('library.confirmRemove') : removeLabel}
                </MenuItem>
              </>
            )}
          </>
        )}
      </Popover>
      {editing && (
        <TagEditor
          track={track}
          onClose={() => {
            setEditing(false);
            returnFocus();
          }}
          onSaved={onChange}
        />
      )}
      {rematching && (
        <RematchDialog
          track={track}
          onClose={() => {
            setRematching(false);
            returnFocus();
          }}
          onReplaced={onChange}
        />
      )}
    </li>
  );
}
