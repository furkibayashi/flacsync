import clsx from 'clsx';
import { ArrowLeft, FolderOpen, Library, Loader2, Play, RefreshCw, Search, Shuffle, Tags, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlaylistDetail, PlaylistsGrid, type ListRef } from '../components/LibraryPlaylists';
import { LibraryTools } from '../components/LibraryTools';
import { LibraryCover as Cover, LibrarySongRow, toPlayerTrack } from '../components/LibrarySongRow';
import { useI18n } from '../i18n/I18nProvider';
import { formatBytes } from '../lib/format';
import { formatNumber } from '../lib/time';
import { api, isAbort, toUiError, type UiError } from '../services/api';
import { usePlayer } from '../state/PlayerProvider';
import { useQueue } from '../state/QueueProvider';
import type { Route } from '../state/router';
import { useStoredState } from '../state/settings';
import type { GenreFixStatus, LibraryResponse, LibraryTrack } from '../types/api';

type View = 'songs' | 'albums' | 'playlists' | 'tools';
const isView = (v: unknown): v is View => v === 'songs' || v === 'albums' || v === 'playlists' || v === 'tools';

interface AlbumGroup {
  key: string;
  title: string;
  artist: string;
  year: string | null;
  coverId: string;
  tracks: LibraryTrack[];
}

const albumKey = (t: LibraryTrack) => `${(t.album ?? '').toLowerCase()}|${t.album ? '' : t.artist.toLowerCase()}`;

export function LibraryPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t, lang } = useI18n();
  const player = usePlayer();
  const { stats } = useQueue();
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [view, setView] = useStoredState<View>('flacsync.library.view', 'songs', isView);
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [openList, setOpenList] = useState<ListRef | null>(null);
  const [fix, setFix] = useState<GenreFixStatus | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    return api
      .library(signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => !isAbort(err) && setError(toUiError(err)))
      .finally(() => !signal?.aborted && setLoading(false));
  }, []);

  // İlk açılış + her tamamlanan indirmeden sonra (masaüstünde dosya kaydı biraz sonra biter)
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), stats.completed ? 1500 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, stats.completed]);

  const rescan = async () => {
    setScanning(true);
    try {
      await api.rescanLibrary();
      await load();
    } finally {
      setScanning(false);
    }
  };

  // --- Türleri düzelt (arka planda; ilerleme yarım saniyede bir okunur) ---------------------------
  useEffect(() => {
    void api.genreFixStatus().then((s) => s.running && setFix(s)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!fix?.running) return;
    const timer = setInterval(() => {
      void api.genreFixStatus().then((s) => {
        setFix(s);
        if (!s.running) void load();
      });
    }, 700);
    return () => clearInterval(timer);
  }, [fix?.running, load]);

  const startFix = async () => {
    const s = await api.startGenreFix().catch(() => null);
    if (s) setFix(s);
  };

  /** Satırda tür değişti: listeyi ve tür filtrelerini yerinde güncelle */
  const onTrackChange = (updated: LibraryTrack) =>
    setData((d) => {
      if (!d) return d;
      const tracks = d.tracks.map((x) => (x.id === updated.id ? { ...x, ...updated } : x));
      const counts = new Map<string, number>();
      for (const x of tracks) if (x.genre) counts.set(x.genre, (counts.get(x.genre) ?? 0) + 1);
      return { ...d, tracks, genres: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
    });

  const knownGenres = useMemo(() => (data?.genres ?? []).map((g) => g.name), [data]);

  const remove = async (track: LibraryTrack) => {
    await api.removeFromLibrary(track.id).catch(() => undefined);
    setData((d) => (d ? { ...d, tracks: d.tracks.filter((x) => x.id !== track.id) } : d));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(lang);
    return (data?.tracks ?? []).filter(
      (tr) =>
        (!genre || tr.genre === genre) &&
        (!q || `${tr.title} ${tr.artist} ${tr.album ?? ''}`.toLocaleLowerCase(lang).includes(q)),
    );
  }, [data, query, genre, lang]);

  const albums = useMemo(() => {
    const map = new Map<string, AlbumGroup>();
    for (const tr of filtered) {
      const key = albumKey(tr);
      let g = map.get(key);
      if (!g) {
        g = { key, title: tr.album ?? t('library.singles'), artist: tr.artist, year: tr.year, coverId: tr.id, tracks: [] };
        map.set(key, g);
      }
      g.tracks.push(tr);
    }
    for (const g of map.values()) {
      g.tracks.sort((a, b) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999) || a.title.localeCompare(b.title));
      const artists = new Set(g.tracks.map((x) => x.artist));
      if (artists.size > 1) g.artist = t('library.variousArtists');
    }
    return [...map.values()];
  }, [filtered, t]);

  const album = openAlbum ? albums.find((a) => a.key === openAlbum) ?? null : null;
  const list = album ? album.tracks : filtered;

  const playFrom = (tracks: LibraryTrack[], track: LibraryTrack) => {
    const id = `lib:${track.id}`;
    if (player.current?.id === id) return player.toggle();
    player.playList(tracks.map(toPlayerTrack), tracks.indexOf(track));
  };

  const playAll = (tracks: LibraryTrack[], shuffle = false) => {
    if (tracks.length) player.playList(tracks.map(toPlayerTrack), 0, { shuffle });
  };

  const total = data?.tracks.length ?? 0;

  return (
    <div className="animate-rise space-y-7 pb-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-display text-3xl font-extrabold tracking-tight text-paper sm:text-4xl">
            <Library className="size-8 text-amber" />
            {t('library.title')}
          </h1>
          <p className="mt-2 text-dust">
            {data
              ? t('library.summary', { count: formatNumber(total, lang), size: formatBytes(data.totalBytes) })
              : t('library.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!filtered.length}
            onClick={() => playAll(list)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40"
          >
            <Play className="size-4 fill-current" />
            {t('library.playAll')}
          </button>
          <button
            type="button"
            disabled={!filtered.length}
            onClick={() => playAll(list, true)}
            className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-40"
          >
            <Shuffle className="size-4" />
            {t('library.shuffle')}
          </button>
          <button
            type="button"
            onClick={() => void startFix()}
            disabled={fix?.running || !total}
            title={t('library.fixGenresHint')}
            className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-50"
          >
            {fix?.running ? <Loader2 className="size-4 animate-spin" /> : <Tags className="size-4" />}
            {fix?.running ? t('library.fixGenresProgress', { done: fix.done, total: fix.total }) : t('library.fixGenres')}
          </button>
          <button
            type="button"
            onClick={() => void rescan()}
            disabled={scanning}
            title={t('library.rescanHint')}
            className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-50"
          >
            <RefreshCw className={clsx('size-4', scanning && 'animate-spin')} />
            {t('library.rescan')}
          </button>
          {window.flacsync && (
            <button
              type="button"
              onClick={() => void window.flacsync?.openLocation('library')}
              title={data?.dir}
              className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust"
            >
              <FolderOpen className="size-4" />
              {t('library.openFolder')}
            </button>
          )}
        </div>
      </header>

      {total > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className={clsx('relative flex-1', (view === 'playlists' || view === 'tools') && 'invisible')}>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fade" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.search')}
                aria-label={t('library.search')}
                className="h-11 w-full rounded-xl bg-panel pr-10 pl-10 text-paper ring-1 ring-rule outline-none placeholder:text-fade focus:ring-amber"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('library.clearSearch')}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-fade hover:text-paper"
                >
                  <X className="size-4" />
                </button>
              )}
            </label>
            <div role="group" aria-label={t('library.view')} className="inline-flex shrink-0 rounded-xl bg-panel p-1 ring-1 ring-rule">
              {(window.flacsync ? (['songs', 'albums', 'playlists', 'tools'] as const) : (['songs', 'albums', 'playlists'] as const)).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => {
                    setView(v);
                    setOpenAlbum(null);
                    setOpenList(null);
                  }}
                  className={clsx(
                    'rounded-lg px-4 py-1.5 text-sm font-semibold transition',
                    view === v ? 'bg-paper text-night' : 'text-dust hover:text-paper',
                  )}
                >
                  {t(v === 'songs' ? 'library.songs' : v === 'albums' ? 'library.albums' : v === 'playlists' ? 'library.playlists' : 'library.tools')}
                </button>
              ))}
            </div>
          </div>

          {data && data.genres.length > 0 && view !== 'playlists' && view !== 'tools' && (
            <div role="group" aria-label={t('discover.genres')} className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={genre === null}
                onClick={() => setGenre(null)}
                className={clsx(
                  'rounded-full px-3.5 py-1 text-sm font-semibold transition',
                  genre === null ? 'bg-amber text-on-accent' : 'bg-panel text-dust ring-1 ring-rule hover:text-paper',
                )}
              >
                {t('genre.all')}
              </button>
              {data.genres.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  aria-pressed={genre === g.name}
                  onClick={() => setGenre(genre === g.name ? null : g.name)}
                  className={clsx(
                    'rounded-full px-3.5 py-1 text-sm font-semibold transition',
                    genre === g.name ? 'bg-amber text-on-accent' : 'bg-panel text-dust ring-1 ring-rule hover:text-paper',
                  )}
                >
                  {g.name} <span className="ml-1 text-xs opacity-60">{g.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="grid place-items-center py-24 text-dust">
          <Loader2 className="size-8 animate-spin" />
        </div>
      )}
      {error && <p className="rounded-xl bg-danger/10 p-4 text-danger ring-1 ring-danger/30">{error.message}</p>}

      {data && total === 0 && (
        <div className="rounded-3xl bg-panel/70 px-6 py-16 text-center ring-1 ring-rule">
          <Library className="mx-auto size-12 text-fade" strokeWidth={1.25} />
          <h2 className="mt-4 font-display text-2xl font-bold text-paper">{t('library.emptyTitle')}</h2>
          <p className="mx-auto mt-2 max-w-md text-dust">{t('library.emptyText')}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('discover')}
              className="rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi"
            >
              {t('nav.discover')}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('search')}
              className="rounded-xl bg-raised px-5 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust"
            >
              {t('nav.search')}
            </button>
          </div>
        </div>
      )}

      {/* Albüm ayrıntısı */}
      {album && (
        <section className="space-y-5">
          <button type="button" onClick={() => setOpenAlbum(null)} className="inline-flex items-center gap-2 text-sm font-semibold text-dust hover:text-paper">
            <ArrowLeft className="size-4" />
            {t('library.allAlbums')}
          </button>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            <Cover id={album.coverId} className="size-40 rounded-xl shadow-2xl shadow-black/40" />
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-wide text-amber uppercase">{t('collection.album')}</p>
              <h2 className="mt-1 font-display text-3xl font-extrabold text-paper">{album.title}</h2>
              <p className="mt-1 text-dust">
                {album.artist}
                {album.year ? ` · ${album.year}` : ''} · {t('library.trackCount', { count: album.tracks.length })}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => playAll(album.tracks)}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi"
                >
                  <Play className="size-4 fill-current" />
                  {t('library.play')}
                </button>
                <button
                  type="button"
                  onClick={() => playAll(album.tracks, true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust"
                >
                  <Shuffle className="size-4" />
                  {t('library.shuffle')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {fix && !fix.running && fix.finishedAt && (
        <p className="flex items-center justify-between gap-3 rounded-xl bg-ok/10 px-4 py-3 text-sm text-paper ring-1 ring-ok/30">
          <span>
            {t('library.fixGenresDone', { changed: fix.changed, total: fix.total })}
            {fix.tagFailed > 0 && <span className="text-dust"> · {t('library.fixGenresTagFailed', { count: fix.tagFailed })}</span>}
          </span>
          <button type="button" onClick={() => setFix(null)} aria-label={t('lyrics.close')} className="text-dust hover:text-paper">
            <X className="size-4" />
          </button>
        </p>
      )}

      {data && total > 0 && view === 'tools' && <LibraryTools onChanged={() => void load()} />}
      {data && total > 0 && view === 'playlists' && !openList && <PlaylistsGrid tracks={data.tracks} onOpen={setOpenList} />}
      {data && view === 'playlists' && openList && (
        <PlaylistDetail
          listRef={openList}
          tracks={data.tracks}
          knownGenres={knownGenres}
          onBack={() => setOpenList(null)}
          onTrackChange={onTrackChange}
        />
      )}

      {data && total > 0 && (view === 'songs' || album) && (
        <ol className="space-y-0.5">
          {list.map((track, i) => (
            <LibrarySongRow
              key={track.id}
              track={track}
              index={i}
              showAlbum={!album}
              knownGenres={knownGenres}
              onChange={onTrackChange}
              onPlay={() => playFrom(list, track)}
              onRemove={() => void remove(track)}
              removeLabel={t('library.remove')}
            />
          ))}
        </ol>
      )}

      {data && total > 0 && view === 'albums' && !album && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {albums.map((a) => (
            <div key={a.key} className="group">
              <button type="button" onClick={() => setOpenAlbum(a.key)} className="block w-full text-left">
                <span className="relative block aspect-square overflow-hidden rounded-xl shadow-lg shadow-black/30 ring-1 ring-rule">
                  <Cover id={a.coverId} className="size-full transition duration-500 group-hover:scale-105" />
                </span>
                <span className="mt-2.5 block truncate font-semibold text-paper group-hover:text-amber">{a.title}</span>
                <span className="block truncate text-sm text-dust">
                  {a.artist} · {t('library.trackCount', { count: a.tracks.length })}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {data && total > 0 && filtered.length === 0 && <p className="py-12 text-center text-dust">{t('library.noMatch')}</p>}
    </div>
  );
}
