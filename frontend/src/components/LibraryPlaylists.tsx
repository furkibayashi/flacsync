import clsx from 'clsx';
import { ArrowLeft, Clock, Download, FolderOpen, Flame, ListMusic, Play, Plus, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { api } from '../services/api';
import { usePlayer } from '../state/PlayerProvider';
import { usePlaylists } from '../state/playlists';
import type { LibraryTrack, Playlist } from '../types/api';
import { LibraryCover, LibrarySongRow, toPlayerTrack } from './LibrarySongRow';

export type SmartKey = 'most-played' | 'recent' | 'unplayed';
export type ListRef = { kind: 'smart'; key: SmartKey } | { kind: 'user'; id: string };

const SMART: Array<{ key: SmartKey; icon: typeof Flame; gradient: string }> = [
  { key: 'most-played', icon: Flame, gradient: 'from-amber/80 to-danger/70' },
  { key: 'recent', icon: Sparkles, gradient: 'from-flac/80 to-amber/60' },
  { key: 'unplayed', icon: Clock, gradient: 'from-ok/70 to-flac/70' },
];

/** Akıllı listeler kütüphaneden otomatik oluşur */
export function smartTracks(key: SmartKey, tracks: LibraryTrack[]): LibraryTrack[] {
  switch (key) {
    case 'most-played':
      return tracks
        .filter((t) => t.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount || (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''))
        .slice(0, 50);
    case 'recent':
      return [...tracks].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 50);
    case 'unplayed':
      return tracks.filter((t) => t.playCount === 0);
  }
}

const minutes = (sec: number) => Math.round(sec / 60);

/** 2×2 kapak mozaiği (liste kapağı) */
function Mosaic({ ids, className }: { ids: string[]; className?: string }) {
  if (ids.length === 0) {
    return (
      <span className={clsx('grid place-items-center bg-raised text-fade', className)}>
        <ListMusic className="size-1/3" strokeWidth={1.25} />
      </span>
    );
  }
  if (ids.length < 4) return <LibraryCover id={ids[0]!} className={className} />;
  return (
    <span className={clsx('grid grid-cols-2 overflow-hidden', className)}>
      {ids.slice(0, 4).map((id) => (
        <LibraryCover key={id} id={id} className="size-full" />
      ))}
    </span>
  );
}

function Tile({ cover, title, subtitle, onClick }: { cover: ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <span className="relative block aspect-square overflow-hidden rounded-xl shadow-lg shadow-black/30 ring-1 ring-rule transition group-hover:ring-amber/60">
        {cover}
      </span>
      <span className="mt-2.5 block truncate font-semibold text-paper group-hover:text-amber">{title}</span>
      <span className="block truncate text-sm text-dust">{subtitle}</span>
    </button>
  );
}

export function PlaylistsGrid({ tracks, onOpen }: { tracks: LibraryTrack[]; onOpen: (ref: ListRef) => void }) {
  const { t } = useI18n();
  const { playlists, reload } = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const p = await api.createPlaylist(trimmed).catch(() => null);
    setName('');
    setCreating(false);
    reload();
    if (p) onOpen({ kind: 'user', id: p.id });
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 font-display text-xl font-bold text-paper">{t('playlist.smart')}</h2>
        <p className="mb-4 text-sm text-dust">{t('playlist.smartHint')}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {SMART.map(({ key, icon: Icon, gradient }) => {
            const list = smartTracks(key, tracks);
            return (
              <Tile
                key={key}
                onClick={() => onOpen({ kind: 'smart', key })}
                title={t(`playlist.smart.${key}` as 'playlist.smart.recent')}
                subtitle={t('library.trackCount', { count: list.length })}
                cover={
                  <span className={clsx('grid size-full place-items-center bg-gradient-to-br text-white', gradient)}>
                    <Icon className="size-1/3 drop-shadow-lg" strokeWidth={1.75} />
                  </span>
                }
              />
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-paper">{t('playlist.mine')}</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {/* Yeni liste */}
          <div>
            {creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
                className="flex aspect-square flex-col justify-center gap-2 rounded-xl bg-panel p-4 ring-1 ring-amber/60"
              >
                <input
                  autoFocus
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
                  placeholder={t('playlist.namePlaceholder')}
                  className="h-10 rounded-lg bg-night px-3 text-sm text-paper ring-1 ring-rule outline-none focus:ring-amber"
                />
                <button type="submit" disabled={!name.trim()} className="h-9 rounded-lg bg-amber text-sm font-bold text-on-accent disabled:opacity-40">
                  {t('playlist.create')}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-rule text-dust transition hover:border-amber hover:text-amber"
              >
                <span className="flex flex-col items-center gap-2 font-semibold">
                  <Plus className="size-8" />
                  {t('playlist.new')}
                </span>
              </button>
            )}
          </div>
          {playlists.map((p) => (
            <Tile
              key={p.id}
              onClick={() => onOpen({ kind: 'user', id: p.id })}
              title={p.name}
              subtitle={`${t('library.trackCount', { count: p.available })}${p.duration ? ` · ${t('collection.minutes', { min: minutes(p.duration) })}` : ''}`}
              cover={<Mosaic ids={p.coverIds} className="size-full" />}
            />
          ))}
        </div>
        {playlists.length === 0 && !creating && <p className="mt-4 text-sm text-dust">{t('playlist.emptyHint')}</p>}
      </section>
    </div>
  );
}

export function PlaylistDetail({
  listRef,
  tracks,
  knownGenres,
  onBack,
  onTrackChange,
}: {
  listRef: ListRef;
  tracks: LibraryTrack[];
  knownGenres: string[];
  onBack: () => void;
  onTrackChange: (t: LibraryTrack) => void;
}) {
  const { t } = useI18n();
  const player = usePlayer();
  const { playlists, reload } = usePlaylists();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [exported, setExported] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const playlist: Playlist | null = listRef.kind === 'user' ? playlists.find((p) => p.id === listRef.id) ?? null : null;
  const byId = useMemo(() => new Map(tracks.map((x) => [x.id, x])), [tracks]);
  const list = useMemo(
    () =>
      listRef.kind === 'smart'
        ? smartTracks(listRef.key, tracks)
        : (playlist?.trackIds ?? []).map((id) => byId.get(id)).filter((x): x is LibraryTrack => Boolean(x)),
    [listRef, tracks, playlist, byId],
  );
  const title = listRef.kind === 'smart' ? t(`playlist.smart.${listRef.key}` as 'playlist.smart.recent') : playlist?.name ?? '';
  const totalSec = list.reduce((s, x) => s + (x.duration ?? 0), 0);

  const play = (start: number, shuffle = false) => {
    const queue = list.map(toPlayerTrack);
    if (queue.length) player.playList(queue, start, { shuffle });
  };

  const removeFromList = async (trackId: string) => {
    if (!playlist) return;
    await api.updatePlaylist(playlist.id, { trackIds: playlist.trackIds.filter((id) => id !== trackId) }).catch(() => undefined);
    reload();
  };

  const rename = async () => {
    if (!playlist || !name.trim()) return setRenaming(false);
    await api.updatePlaylist(playlist.id, { name: name.trim() }).catch(() => undefined);
    setRenaming(false);
    reload();
  };

  const exportToFolder = async () => {
    if (!playlist) return;
    const r = await api.exportPlaylist(playlist.id).catch(() => null);
    setExported(r?.file ?? null);
  };

  const remove = async () => {
    if (!playlist) return;
    await api.deletePlaylist(playlist.id).catch(() => undefined);
    reload();
    onBack();
  };

  if (listRef.kind === 'user' && !playlist) return null;

  const btn = 'inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust';

  return (
    <section className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-dust hover:text-paper">
        <ArrowLeft className="size-4" />
        {t('playlist.all')}
      </button>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        {listRef.kind === 'smart' ? (
          <span
            className={clsx(
              'grid size-44 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-2xl shadow-black/40',
              SMART.find((s) => s.key === listRef.key)?.gradient,
            )}
          >
            {(() => {
              const Icon = SMART.find((s) => s.key === listRef.key)!.icon;
              return <Icon className="size-16" strokeWidth={1.75} />;
            })()}
          </span>
        ) : (
          <Mosaic ids={playlist?.coverIds ?? []} className="size-44 shrink-0 rounded-xl shadow-2xl shadow-black/40" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tracking-wide text-amber uppercase">
            {listRef.kind === 'smart' ? t('playlist.smartLabel') : t('playlist.label')}
          </p>
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void rename()}
                className="mt-1 w-full bg-transparent font-display text-4xl font-extrabold text-paper outline-none"
              />
            </form>
          ) : (
            <h2
              className={clsx('mt-1 font-display text-4xl font-extrabold break-words text-paper', playlist && 'cursor-text')}
              onDoubleClick={() => {
                if (!playlist) return;
                setName(playlist.name);
                setRenaming(true);
              }}
              title={playlist ? t('playlist.renameHint') : undefined}
            >
              {title}
            </h2>
          )}
          <p className="mt-1 text-dust">
            {t('library.trackCount', { count: list.length })}
            {totalSec ? ` · ${t('collection.minutes', { min: minutes(totalSec) })}` : ''}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!list.length}
              onClick={() => play(0)}
              className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40"
            >
              <Play className="size-4 fill-current" />
              {t('library.play')}
            </button>
            <button type="button" disabled={!list.length} onClick={() => play(0, true)} className={clsx(btn, 'disabled:opacity-40')}>
              <Shuffle className="size-4" />
              {t('library.shuffle')}
            </button>
            {playlist && (
              <>
                {window.flacsync ? (
                  <button type="button" disabled={!list.length} onClick={() => void exportToFolder()} className={clsx(btn, 'disabled:opacity-40')} title={t('playlist.exportHint')}>
                    <FolderOpen className="size-4" />
                    {t('playlist.export')}
                  </button>
                ) : (
                  <a href={api.playlistM3uUrl(playlist.id)} className={btn} title={t('playlist.exportHint')}>
                    <Download className="size-4" />
                    M3U8
                  </a>
                )}
                {confirmDelete ? (
                  <button type="button" onClick={() => void remove()} className={clsx(btn, 'text-danger ring-danger/50')}>
                    <Trash2 className="size-4" />
                    {t('playlist.confirmDelete')}
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} className={btn} title={t('playlist.delete')}>
                    <Trash2 className="size-4" />
                  </button>
                )}
              </>
            )}
          </div>
          {exported && (
            <p className="mt-3 text-sm text-dust">
              {t('playlist.exported')}{' '}
              <button type="button" onClick={() => void window.flacsync?.openLocation('library')} className="font-semibold text-amber hover:underline">
                {exported}
              </button>
            </p>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="py-10 text-center text-dust">
          {listRef.kind === 'smart' && listRef.key === 'most-played' ? t('playlist.noPlays') : t('playlist.empty')}
        </p>
      ) : (
        <ol className="space-y-0.5">
          {list.map((track, i) => (
            <LibrarySongRow
              key={track.id}
              track={{ ...track, trackNumber: null }}
              index={i}
              showAlbum
              knownGenres={knownGenres}
              onChange={onTrackChange}
              onPlay={() => {
                if (player.current?.id === `lib:${track.id}`) player.toggle();
                else play(i);
              }}
              onRemove={playlist ? () => void removeFromList(track.id) : undefined}
              removeLabel={t('playlist.removeTrack')}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
