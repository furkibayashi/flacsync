import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CheckSquare,
  FolderOpen,
  Library,
  ListEnd,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Tags,
  Trash2,
  X,
  Heart,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { PlaylistDetail, PlaylistsGrid, type ListRef } from '../components/LibraryPlaylists';
import { LibraryTools } from '../components/LibraryTools';
import { LibraryCover as Cover, LibrarySongRow, toPlayerTrack } from '../components/LibrarySongRow';
import { useI18n } from '../i18n/I18nProvider';
import { formatBytes } from '../lib/format';
import { needsReview } from '../lib/match';
import { foldText } from '../lib/text';
import { formatNumber } from '../lib/time';
import { api, isAbort, toUiError, type UiError } from '../services/api';
import { invalidateLibraryMatch } from '../state/libraryMatch';
import { setLikedMany, useLikedSet } from '../state/likes';
import { usePlayer } from '../state/PlayerProvider';
import { useQueue } from '../state/QueueProvider';
import type { Route } from '../state/router';
import { useStoredState } from '../state/settings';
import type { GenreFixStatus, LibraryResponse, LibraryTrack } from '../types/api';

type View = 'songs' | 'albums' | 'artists' | 'playlists' | 'tools';
const VIEWS: readonly View[] = ['songs', 'albums', 'artists', 'playlists', 'tools'];
const isView = (v: unknown): v is View => VIEWS.includes(v as View);

type Sort = 'added' | 'title' | 'artist' | 'album' | 'year' | 'plays' | 'duration';
const SORTS: readonly Sort[] = ['added', 'title', 'artist', 'album', 'year', 'plays', 'duration'];
const isSort = (v: unknown): v is Sort => SORTS.includes(v as Sort);

/** Binlerce satırı birden çizmemek için liste parça parça açılır */
const CHUNK = 200;

interface AlbumGroup {
  key: string;
  title: string;
  artist: string;
  year: string | null;
  coverId: string;
  tracks: LibraryTrack[];
}

interface ArtistGroup {
  key: string;
  name: string;
  coverId: string;
  tracks: LibraryTrack[];
}

/** ArtistLinks ile aynı kural: virgül ve feat. böler; "&" ve "ve" bölmez */
const ARTIST_SPLIT = /\s*,\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i;
const splitArtists = (a: string) =>
  a
    .split(ARTIST_SPLIT)
    .map((x) => x.trim())
    .filter(Boolean);
const primaryArtist = (a: string) => splitArtists(a)[0] ?? a;

const compareText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base', numeric: true });

function sortTracks(tracks: LibraryTrack[], sort: Sort): LibraryTrack[] {
  const out = [...tracks];
  switch (sort) {
    case 'added':
      return out.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    case 'title':
      return out.sort((a, b) => compareText(a.title, b.title));
    case 'artist':
      return out.sort((a, b) => compareText(a.artist, b.artist) || compareText(a.album, b.album) || (a.trackNumber ?? 999) - (b.trackNumber ?? 999));
    case 'album':
      return out.sort((a, b) => compareText(a.album, b.album) || (a.trackNumber ?? 999) - (b.trackNumber ?? 999));
    case 'year':
      return out.sort((a, b) => compareText(b.year, a.year) || compareText(a.album, b.album) || (a.trackNumber ?? 999) - (b.trackNumber ?? 999));
    case 'plays':
      return out.sort((a, b) => b.playCount - a.playCount || compareText(b.lastPlayedAt, a.lastPlayedAt));
    case 'duration':
      return out.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  }
}

/**
 * Albümleri gruplar. Aynı adlı iki albüm (ör. iki farklı sanatçının "Greatest Hits"i) karışmasın diye
 * ad + ana sanatçıya göre ayrılır; ama parça numaraları çakışmayan çok sanatçılı bir albüm
 * (derleme, film müziği) tek albüm olarak kalır.
 */
function groupAlbums(tracks: LibraryTrack[], singlesLabel: string, variousLabel: string): AlbumGroup[] {
  const byTitle = new Map<string, LibraryTrack[]>();
  for (const tr of tracks) {
    const key = tr.album ? `a:${tr.album.toLocaleLowerCase()}` : `s:${primaryArtist(tr.artist).toLocaleLowerCase()}`;
    const list = byTitle.get(key);
    if (list) list.push(tr);
    else byTitle.set(key, [tr]);
  }

  const groups: AlbumGroup[] = [];
  const make = (key: string, list: LibraryTrack[]): AlbumGroup => {
    const first = list[0]!;
    const sorted = [...list].sort((a, b) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999) || a.title.localeCompare(b.title));
    const artists = new Set(sorted.map((x) => primaryArtist(x.artist).toLocaleLowerCase()));
    return {
      key,
      title: first.album ?? singlesLabel,
      artist: artists.size > 1 ? variousLabel : primaryArtist(first.artist),
      year: sorted.find((x) => x.year)?.year ?? null,
      coverId: sorted[0]!.id,
      tracks: sorted,
    };
  };

  for (const [titleKey, list] of byTitle) {
    if (titleKey.startsWith('s:')) {
      groups.push(make(titleKey, list));
      continue;
    }
    const byArtist = new Map<string, LibraryTrack[]>();
    for (const tr of list) {
      const a = primaryArtist(tr.artist).toLocaleLowerCase();
      const part = byArtist.get(a);
      if (part) part.push(tr);
      else byArtist.set(a, [tr]);
    }
    const numbers = list.map((x) => x.trackNumber).filter((n): n is number => n !== null);
    const collide = new Set(numbers).size !== numbers.length;
    if (byArtist.size === 1 || !collide) groups.push(make(titleKey, list));
    else for (const [a, part] of byArtist) groups.push(make(`${titleKey}|${a}`, part));
  }
  return groups;
}

function groupArtists(tracks: LibraryTrack[]): ArtistGroup[] {
  const map = new Map<string, ArtistGroup>();
  for (const tr of tracks) {
    for (const name of splitArtists(tr.artist)) {
      const key = name.toLocaleLowerCase();
      const g = map.get(key);
      if (g) g.tracks.push(tr);
      else map.set(key, { key, name, coverId: tr.id, tracks: [tr] });
    }
  }
  return [...map.values()].sort((a, b) => b.tracks.length - a.tracks.length || compareText(a.name, b.name));
}

/** Uzun listeyi parça parça gösterir: sona yaklaşınca bir parça daha eklenir */
function useChunked<T>(list: T[], resetKey: string) {
  const [limit, setLimit] = useState(CHUNK);
  // Geri çağırımlı ref: görünüm değişip öğe yeniden takılınca gözlemci de yeniden kurulur
  const [el, sentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => setLimit(CHUNK), [resetKey]);
  useEffect(() => {
    if (!el || limit >= list.length) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((l) => l + CHUNK), {
      rootMargin: '800px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [el, limit, list.length]);
  return { visible: list.length > limit ? list.slice(0, limit) : list, more: limit < list.length, sentinel };
}

async function removeIds(ids: string[]): Promise<{ removed: string[]; failed: string[] }> {
  const removed: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = ids.slice(i, i + 6);
    const results = await Promise.allSettled(batch.map((id) => api.removeFromLibrary(id)));
    results.forEach((r, j) => (r.status === 'fulfilled' ? removed : failed).push(batch[j]!));
  }
  return { removed, failed };
}

const softBtn =
  'inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-40';

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
  const [sort, setSort] = useStoredState<Sort>('flacsync.library.sort', 'added', isSort);
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [openArtistKey, setOpenArtistKey] = useState<string | null>(null);
  const [openList, setOpenList] = useState<ListRef | null>(null);
  const [fix, setFix] = useState<GenreFixStatus | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Yalnızca eşleşmesi zayıf şarkıları göster (kontrol kipi) */
  const [reviewOnly, setReviewOnly] = useState(false);
  /** Shift ile aralık seçiminin başlangıcı: sıra değişse de doğru şarkı kalsın diye kimlik tutulur */
  const lastPicked = useRef<string | null>(null);

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

  /** Silinenleri listeden çıkarır; silinemeyenler yerinde kalır ve kullanıcıya söylenir */
  const removeMany = async (ids: string[]) => {
    setDeleting(true);
    const { removed, failed } = await removeIds(ids);
    setDeleting(false);
    const gone = new Set(removed);
    if (gone.size) {
      setData((d) => (d ? { ...d, tracks: d.tracks.filter((x) => !gone.has(x.id)) } : d));
      invalidateLibraryMatch();
    }
    setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
    setNotice(failed.length ? t('library.deleteFailed', { count: failed.length }) : null);
    return failed.length === 0;
  };

  const reviewCount = useMemo(() => (data?.tracks ?? []).filter((tr) => needsReview(tr.source)).length, [data]);
  useEffect(() => {
    if (reviewOnly && reviewCount === 0) setReviewOnly(false);
  }, [reviewOnly, reviewCount]);
  // Kontrol kipi yalnızca "Şarkılar" listesine aittir; başka görünüme geçince kapanır
  useEffect(() => setReviewOnly(false), [view]);

  /** Aranabilir metin bir kez hazırlanır (her tuşta binlerce şarkıyı yeniden sadeleştirmemek için) */
  const searchText = useMemo(
    () => new Map((data?.tracks ?? []).map((tr) => [tr.id, foldText(`${tr.title} ${tr.artist} ${tr.album ?? ''}`)])),
    [data],
  );

  const filtered = useMemo(() => {
    // Aksan / büyük-küçük harf / Türkçe ı duyarsız: "gulumse" → "Gülümse"
    const q = foldText(query);
    return (data?.tracks ?? []).filter(
      (tr) =>
        (!reviewOnly || needsReview(tr.source)) &&
        (!genre || tr.genre === genre) &&
        (!q || (searchText.get(tr.id) ?? '').includes(q)),
    );
  }, [data, query, genre, reviewOnly, searchText]);

  const sorted = useMemo(() => sortTracks(filtered, sort), [filtered, sort]);

  const albums = useMemo(() => groupAlbums(sorted, t('library.singles'), t('library.variousArtists')), [sorted, t]);
  const artists = useMemo(() => groupArtists(filtered), [filtered]);

  const album = openAlbum ? albums.find((a) => a.key === openAlbum) ?? null : null;
  const artist = openArtistKey ? artists.find((a) => a.key === openArtistKey) ?? null : null;
  const artistTracks = useMemo(() => (artist ? sortTracks(artist.tracks, sort) : []), [artist, sort]);
  const list = album ? album.tracks : artist ? artistTracks : sorted;
  const showList = view === 'songs' || Boolean(album) || Boolean(artist);
  const { visible, more, sentinel } = useChunked(list, `${view}|${openAlbum}|${openArtistKey}|${sort}|${query}|${genre}`);

  // Görünüm ya da liste değişince seçim temizlenir
  useEffect(() => {
    setSelected(new Set());
    setConfirmBulk(false);
    lastPicked.current = null;
  }, [view, openAlbum, openArtistKey, query, genre, sort]);
  useEffect(() => {
    if (!confirmBulk) return;
    const timer = setTimeout(() => setConfirmBulk(false), 6000);
    return () => clearTimeout(timer);
  }, [confirmBulk]);

  const pick = (index: number, range: boolean) => {
    const id = list[index]!.id;
    const anchorIndex = lastPicked.current ? list.findIndex((x) => x.id === lastPicked.current) : -1;
    const anchor = anchorIndex >= 0 ? anchorIndex : null;
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor !== null) {
        const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)];
        const on = !prev.has(id);
        for (let i = from; i <= to; i++) (on ? next.add(list[i]!.id) : next.delete(list[i]!.id));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastPicked.current = id;
    setConfirmBulk(false);
  };

  const selectedTracks = useMemo(() => list.filter((x) => selected.has(x.id)), [list, selected]);
  const likedSet = useLikedSet();
  const allSelectedLiked = selectedTracks.length > 0 && selectedTracks.every((x) => likedSet.has(x.id));

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmBulk(false);
  };

  const playFrom = (tracks: LibraryTrack[], track: LibraryTrack) => {
    const id = `lib:${track.id}`;
    if (player.current?.id === id) return player.toggle();
    player.playList(tracks.map(toPlayerTrack), tracks.indexOf(track));
  };

  const playAll = (tracks: LibraryTrack[], shuffle = false) => {
    if (tracks.length) player.playList(tracks.map(toPlayerTrack), 0, { shuffle });
  };

  const total = data?.tracks.length ?? 0;
  const searchable = view !== 'playlists' && view !== 'tools';
  const viewLabel = (v: View) =>
    t(
      v === 'songs'
        ? 'library.songs'
        : v === 'albums'
          ? 'library.albums'
          : v === 'artists'
            ? 'library.artists'
            : v === 'playlists'
              ? 'library.playlists'
              : 'library.tools',
    );

  const detailHeader = (opts: { kicker: string; title: string; sub: string; coverId: string; round?: boolean; tracks: LibraryTrack[]; back: () => void; backLabel: string }) => (
    <section className="space-y-5">
      <button type="button" onClick={opts.back} className="inline-flex items-center gap-2 text-sm font-semibold text-dust hover:text-paper">
        <ArrowLeft className="size-4" />
        {opts.backLabel}
      </button>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover id={opts.coverId} className={clsx('size-40 shadow-2xl shadow-black/40', opts.round ? 'rounded-full' : 'rounded-xl')} />
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-wide text-amber uppercase">{opts.kicker}</p>
          <h2 className="mt-1 font-display text-3xl font-extrabold text-paper">{opts.title}</h2>
          <p className="mt-1 text-dust">{opts.sub}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => playAll(opts.tracks)}
              className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi"
            >
              <Play className="size-4 fill-current" />
              {t('library.play')}
            </button>
            <button type="button" onClick={() => playAll(opts.tracks, true)} className={softBtn}>
              <Shuffle className="size-4" />
              {t('library.shuffle')}
            </button>
            <button type="button" onClick={() => player.addToQueue(opts.tracks.map(toPlayerTrack))} className={softBtn}>
              <ListEnd className="size-4" />
              {t('player.addToQueue')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );

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
          <button type="button" disabled={!filtered.length} onClick={() => playAll(list, true)} className={softBtn}>
            <Shuffle className="size-4" />
            {t('library.shuffle')}
          </button>
          <button
            type="button"
            onClick={() => void startFix()}
            disabled={fix?.running || !total}
            title={t('library.fixGenresHint')}
            className={softBtn}
          >
            {fix?.running ? <Loader2 className="size-4 animate-spin" /> : <Tags className="size-4" />}
            {fix?.running ? t('library.fixGenresProgress', { done: fix.done, total: fix.total }) : t('library.fixGenres')}
          </button>
          <button type="button" onClick={() => void rescan()} disabled={scanning} title={t('library.rescanHint')} className={softBtn}>
            <RefreshCw className={clsx('size-4', scanning && 'animate-spin')} />
            {t('library.rescan')}
          </button>
          {window.flacsync && (
            <button type="button" onClick={() => void window.flacsync?.openLocation('library')} title={data?.dir} className={softBtn}>
              <FolderOpen className="size-4" />
              {t('library.openFolder')}
            </button>
          )}
        </div>
      </header>

      {total > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className={clsx('relative flex-1', !searchable && 'invisible')}>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fade" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.search')}
                aria-label={t('library.search')}
                className="h-11 w-full rounded-xl bg-panel pr-10 pl-10 text-paper ring-1 ring-rule-strong outline-none placeholder:text-fade focus:ring-amber"
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
            <div role="group" aria-label={t('library.view')} className="inline-flex max-w-full shrink-0 overflow-x-auto rounded-xl bg-panel p-1 ring-1 ring-rule [scrollbar-width:none]">
              {VIEWS.filter((v) => v !== 'tools' || window.flacsync).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => {
                    setView(v);
                    setOpenAlbum(null);
                    setOpenArtistKey(null);
                    setOpenList(null);
                  }}
                  className={clsx(
                    'shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition',
                    view === v ? 'bg-paper text-night' : 'text-dust hover:text-paper',
                  )}
                >
                  {viewLabel(v)}
                </button>
              ))}
            </div>
          </div>

          {data && data.genres.length > 0 && searchable && (
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
            <button type="button" onClick={() => onNavigate('search')} className="rounded-xl bg-raised px-5 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust">
              {t('nav.search')}
            </button>
          </div>
        </div>
      )}

      {album &&
        detailHeader({
          kicker: t('collection.album'),
          title: album.title,
          sub: `${album.artist}${album.year ? ` · ${album.year}` : ''} · ${t('library.trackCount', { count: album.tracks.length })}`,
          coverId: album.coverId,
          tracks: album.tracks,
          back: () => setOpenAlbum(null),
          backLabel: t('library.allAlbums'),
        })}
      {artist &&
        detailHeader({
          kicker: t('library.sort.artist'),
          title: artist.name,
          sub: t('library.trackCount', { count: artist.tracks.length }),
          coverId: artist.coverId,
          round: true,
          tracks: artistTracks,
          back: () => setOpenArtistKey(null),
          backLabel: t('library.allArtists'),
        })}

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

      {notice && (
        <p role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-paper ring-1 ring-danger/30">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('lyrics.close')} className="text-dust hover:text-paper">
            <X className="size-4" />
          </button>
        </p>
      )}

      {window.flacsync && reviewCount > 0 && view === 'songs' && !album && !artist && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber/10 px-4 py-3 text-sm ring-1 ring-amber/30">
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-amber" />
          <p className="min-w-0 flex-1 text-paper">{t('review.banner', { count: reviewCount })}</p>
          <button
            type="button"
            aria-pressed={reviewOnly}
            onClick={() => setReviewOnly((v) => !v)}
            className="h-9 rounded-lg bg-amber px-3 font-bold text-on-accent transition hover:bg-amber-hi"
          >
            {reviewOnly ? t('review.hide') : t('review.show')}
          </button>
        </div>
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

      {data && total > 0 && showList && list.length > 0 && (
        <div className="space-y-2">
          {/* Sıralama + seçim */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!album ? (
              <label className="inline-flex items-center gap-2 text-sm text-dust">
                <ArrowUpDown className="size-4" />
                <span className="sr-only sm:not-sr-only">{t('library.sortBy')}</span>
                <select
                  value={sort}
                  onChange={(e) => isSort(e.target.value) && setSort(e.target.value)}
                  className="h-9 rounded-lg bg-panel px-2.5 font-semibold text-paper ring-1 ring-rule-strong outline-none focus:ring-amber"
                >
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {t(`library.sort.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              className={clsx(
                'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 transition',
                selecting ? 'bg-paper text-night ring-paper' : 'bg-panel text-dust ring-rule hover:text-paper',
              )}
            >
              <CheckSquare className="size-4" />
              {selecting ? t('library.selectDone') : t('library.select')}
            </button>
          </div>

          {selecting && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-panel/95 p-2 pl-4 shadow-xl shadow-black/30 ring-1 ring-rule backdrop-blur">
              <span className="mr-auto text-sm font-semibold text-paper tabular-nums">{t('library.selectedCount', { count: selected.size })}</span>
              {confirmBulk ? (
                <>
                  <span className="text-sm text-danger">{t('library.confirmDeleteMany', { count: selectedTracks.length })}</span>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void removeMany(selectedTracks.map((x) => x.id)).then(() => setConfirmBulk(false))}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-danger px-3 text-sm font-bold text-on-danger disabled:opacity-60"
                  >
                    {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    {t('library.confirmYes')}
                  </button>
                  <button type="button" disabled={deleting} onClick={() => setConfirmBulk(false)} className="h-9 rounded-lg px-3 text-sm font-semibold text-dust hover:text-paper">
                    {t('library.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((x) => x.id)))}
                    className="h-9 rounded-lg px-3 text-sm font-semibold text-dust hover:text-paper"
                  >
                    {selected.size === list.length ? t('library.clearSelection') : t('library.selectAll', { count: list.length })}
                  </button>
                  <button
                    type="button"
                    disabled={!selectedTracks.length}
                    onClick={() => playAll(selectedTracks)}
                    title={t('library.play')}
                    aria-label={t('library.play')}
                    className="grid size-9 place-items-center rounded-lg bg-amber text-on-accent disabled:opacity-40"
                  >
                    <Play className="size-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    disabled={!selectedTracks.length}
                    onClick={() => player.addToQueue(selectedTracks.map(toPlayerTrack))}
                    title={t('player.addToQueue')}
                    aria-label={t('player.addToQueue')}
                    className="grid size-9 place-items-center rounded-lg bg-raised text-paper ring-1 ring-rule hover:ring-dust disabled:opacity-40"
                  >
                    <ListEnd className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!selectedTracks.length}
                    onClick={() => void setLikedMany(selectedTracks.map((x) => x.id), !allSelectedLiked, t('player.likeFailed'))}
                    aria-pressed={allSelectedLiked}
                    title={allSelectedLiked ? t('player.unlike') : t('player.like')}
                    aria-label={allSelectedLiked ? t('player.unlike') : t('player.like')}
                    className={clsx(
                      'grid size-9 place-items-center rounded-lg bg-raised ring-1 ring-rule hover:ring-dust disabled:opacity-40',
                      allSelectedLiked ? 'text-danger' : 'text-paper',
                    )}
                  >
                    <Heart className={clsx('size-4', allSelectedLiked && 'fill-current')} />
                  </button>
                  {selectedTracks.length > 0 && <AddToPlaylist trackIds={selectedTracks.map((x) => x.id)} side="bottom" className="rounded-lg" />}
                  {(
                    <button
                      type="button"
                      disabled={!selectedTracks.length}
                      onClick={() => setConfirmBulk(true)}
                      title={t('library.deleteSelected')}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-danger ring-1 ring-danger/40 hover:bg-danger/10 disabled:opacity-40"
                    >
                      <Trash2 className="size-4" />
                      {t('library.deleteSelected')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <ol className="space-y-0.5">
            {visible.map((track, i) => (
              <LibrarySongRow
                key={track.id}
                track={track}
                index={i}
                showAlbum={!album}
                knownGenres={knownGenres}
                onChange={onTrackChange}
                onPlay={() => playFrom(list, track)}
                onRemove={() => void removeMany([track.id])}
                removeLabel={t('library.remove')}
                confirmRemove
                selectable={selecting}
                reviewing={reviewOnly}
                selected={selected.has(track.id)}
                onSelect={(range) => pick(i, range)}
              />
            ))}
          </ol>
          {more && (
            <div ref={sentinel} className="grid place-items-center py-6 text-fade">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
        </div>
      )}

      {data && total > 0 && view === 'albums' && !album && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {albums.map((a) => (
            <div key={a.key} className="group [content-visibility:auto] [contain-intrinsic-size:auto_260px]">
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

      {data && total > 0 && view === 'artists' && !artist && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {artists.map((a) => (
            <div key={a.key} className="group [content-visibility:auto] [contain-intrinsic-size:auto_240px]">
              <button type="button" onClick={() => setOpenArtistKey(a.key)} className="block w-full text-center">
                <span className="relative mx-auto block aspect-square overflow-hidden rounded-full shadow-lg shadow-black/30 ring-1 ring-rule">
                  <Cover id={a.coverId} className="size-full transition duration-500 group-hover:scale-105" />
                </span>
                <span className="mt-2.5 block truncate font-semibold text-paper group-hover:text-amber">{a.name}</span>
                <span className="block truncate text-sm text-dust">{t('library.trackCount', { count: a.tracks.length })}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {data && total > 0 && searchable && filtered.length === 0 && <p className="py-12 text-center text-dust">{t('library.noMatch')}</p>}
    </div>
  );
}
