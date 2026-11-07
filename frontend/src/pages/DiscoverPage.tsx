import clsx from 'clsx';
import { Check, Compass, Disc3, Loader2, Play, Plus, RefreshCw, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RowPlayButton } from '../components/PlayButton';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { useI18n } from '../i18n/I18nProvider';
import { ArtistLinks } from '../components/ArtistLinks';
import { api, isAbort, toUiError, type UiError } from '../services/api';
import { usePlayer, type PlayerTrack } from '../state/PlayerProvider';
import { useQueue } from '../state/QueueProvider';
import { useStoredState } from '../state/settings';
import type { DiscoverAlbum, DiscoverResponse, DiscoverTrack } from '../types/api';

/** Sunucudaki tür listesiyle aynı (backend/src/services/discover.service.ts) */
const GENRES = [
  { id: 0, key: 'all' },
  { id: 14, key: 'pop' },
  { id: 21, key: 'rock' },
  { id: 18, key: 'hiphop' },
  { id: 7, key: 'electronic' },
  { id: 17, key: 'dance' },
  { id: 20, key: 'alternative' },
  { id: 15, key: 'rnb' },
  { id: 1153, key: 'metal' },
  { id: 11, key: 'jazz' },
  { id: 5, key: 'classical' },
  { id: 12, key: 'latin' },
  { id: 6, key: 'country' },
  { id: 24, key: 'reggae' },
  { id: 2, key: 'blues' },
  { id: 16, key: 'soundtrack' },
  { id: 10, key: 'singer' },
] as const;
const COUNTRIES = ['tr', 'us', 'gb', 'de', 'fr', 'es', 'mx', 'jp', 'kr', 'br'] as const;
/** İlk açılışta dile göre ülke */
const DEFAULT_COUNTRY: Partial<Record<string, (typeof COUNTRIES)[number]>> = { tr: 'tr', de: 'de', fr: 'fr', es: 'es', en: 'us' };
const FIRST_PAGE = 20;

const isGenre = (v: unknown): v is number => typeof v === 'number' && GENRES.some((g) => g.id === v);
const isCountry = (v: unknown): v is string => typeof v === 'string' && (COUNTRIES as readonly string[]).includes(v);

const toPlayerTrack = (t: DiscoverTrack): PlayerTrack => ({
  id: `discover:${t.id}`,
  title: t.title,
  artist: t.artist,
  album: t.album,
  coverUrl: t.coverUrl,
  src: t.previewUrl ?? '',
  kind: 'preview',
  sourceUrl: t.url,
});

function AlbumCard({ album, onOpen }: { album: DiscoverAlbum; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onOpen} className="group text-left">
      <span className="relative block aspect-square overflow-hidden rounded-xl bg-raised shadow-lg shadow-black/30 ring-1 ring-rule">
        {album.coverUrl && !failed ? (
          <img
            src={album.coverUrl}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="size-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <Disc3 className="m-auto size-1/3 h-full text-fade" strokeWidth={1.25} />
        )}
      </span>
      <span className="mt-2.5 block truncate font-semibold text-paper group-hover:text-amber">{album.title}</span>
      <span className="block truncate text-sm text-dust">
        {album.artist}
        {album.releaseYear ? ` · ${album.releaseYear}` : ''}
      </span>
    </button>
  );
}

function TrackRow({
  track,
  index,
  onPlay,
  onAdd,
  added,
}: {
  track: DiscoverTrack;
  index: number;
  onPlay: () => void;
  onAdd: () => void;
  added: boolean;
}) {
  const { t } = useI18n();
  const { current, playing } = usePlayer();
  const active = current?.id === `discover:${track.id}`;
  return (
    <li
      className={clsx(
        'group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised/60 sm:gap-4 sm:px-3',
        active && 'bg-raised/70',
      )}
    >
      <span className={clsx('w-6 shrink-0 text-right font-display text-sm font-bold tabular-nums', index < 3 ? 'text-amber' : 'text-fade')}>
        {track.rank}
      </span>
      <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-raised">
        {track.coverUrl && <img src={track.coverUrl} alt="" loading="lazy" className="size-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate font-semibold', active ? 'text-amber' : 'text-paper')}>{track.title}</span>
        <ArtistLinks names={track.artist} className="block truncate text-sm text-dust" />
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-sm text-fade lg:block">{track.album}</span>
      <RowPlayButton active={active} playing={active && playing} onClick={onPlay} disabled={!track.previewUrl} />
      <button
        type="button"
        onClick={onAdd}
        disabled={added}
        title={added ? t('results.added') : t('results.addToQueue')}
        aria-label={added ? t('results.added') : t('results.addToQueue')}
        className={clsx(
          'grid size-9 shrink-0 place-items-center rounded-full ring-1 transition',
          added ? 'text-ok ring-ok/40' : 'text-dust ring-rule hover:text-paper hover:ring-dust',
        )}
      >
        {added ? <Check className="size-4" /> : <Plus className="size-4" />}
      </button>
    </li>
  );
}

export function DiscoverPage({ onOpen }: { onOpen: (url: string) => void }) {
  const { t, lang } = useI18n();
  const player = usePlayer();
  const queue = useQueue();
  const [format] = usePreferredFormat();
  const [genre, setGenre] = useStoredState<number>('flacsync.discover.genre', 0, isGenre);
  const [country, setCountry] = useStoredState<string>('flacsync.discover.country', DEFAULT_COUNTRY[lang] ?? 'us', isCountry);
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setShowAll(false);
    api
      .discover(genre, country, controller.signal)
      .then(setData)
      .catch((err) => !isAbort(err) && setError(toUiError(err)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [genre, country, reload]);

  const regionName = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([lang], { type: 'region' });
      return (code: string) => names.of(code.toUpperCase()) ?? code.toUpperCase();
    } catch {
      return (code: string) => code.toUpperCase();
    }
  }, [lang]);

  const playable = useMemo(() => (data?.tracks ?? []).filter((tr) => tr.previewUrl), [data]);
  const playerTracks = useMemo(() => playable.map(toPlayerTrack), [playable]);
  const visible = showAll ? data?.tracks ?? [] : (data?.tracks ?? []).slice(0, FIRST_PAGE);
  const genreLabel = t(`genre.${GENRES.find((g) => g.id === genre)?.key ?? 'all'}` as 'genre.all');

  const playFrom = (track: DiscoverTrack) => {
    const id = `discover:${track.id}`;
    if (player.current?.id === id) return player.toggle();
    const start = playerTracks.findIndex((p) => p.id === id);
    if (start >= 0) player.playList(playerTracks, start);
  };

  const add = async (track: DiscoverTrack) => {
    const job = await queue.enqueue(track.url, format);
    if (job) setAdded((s) => new Set(s).add(track.id));
  };

  const top = data?.tracks[0];

  return (
    <div className="animate-rise space-y-8 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-display text-3xl font-extrabold tracking-tight text-paper sm:text-4xl">
            <Compass className="size-8 text-amber" />
            {t('discover.title')}
          </h1>
          <p className="mt-2 max-w-xl text-dust">{t('discover.subtitle')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-dust">
          {t('discover.country')}
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-xl bg-panel px-3 py-2 font-semibold text-paper ring-1 ring-rule outline-none focus-visible:ring-amber"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {regionName(c)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {/* Türler */}
      <div role="group" aria-label={t('discover.genres')} className="-mx-1 flex flex-wrap gap-2 px-1">
        {GENRES.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={genre === g.id}
            onClick={() => setGenre(g.id)}
            className={clsx(
              'rounded-full px-4 py-1.5 text-sm font-semibold transition',
              genre === g.id ? 'bg-amber text-on-accent' : 'bg-panel text-dust ring-1 ring-rule hover:text-paper hover:ring-dust',
            )}
          >
            {t(`genre.${g.key}` as 'genre.all')}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-danger/10 p-4 text-danger ring-1 ring-danger/30">
          <span>{t('discover.error')}</span>
          <button type="button" onClick={() => setReload((n) => n + 1)} className="inline-flex items-center gap-2 font-semibold">
            <RefreshCw className="size-4" />
            {t('discover.retry')}
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="grid place-items-center py-24 text-dust">
          <Loader2 className="size-8 animate-spin" />
        </div>
      )}

      {data && top && (
        <div className={clsx('space-y-10 transition-opacity', loading && 'opacity-50')}>
          {/* Zirvedeki şarkı */}
          <section className="relative overflow-hidden rounded-3xl bg-panel ring-1 ring-rule">
            {top.coverUrl && (
              <img src={top.coverUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-25 blur-3xl" />
            )}
            <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
              {top.coverUrl && (
                <img src={top.coverUrl} alt="" className="size-40 rounded-xl object-cover shadow-2xl shadow-black/50 sm:size-48" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold tracking-wide text-amber uppercase">
                  {genre === 0
                    ? t('discover.topOfAll', { country: regionName(country) })
                    : t('discover.topOf', { genre: genreLabel, country: regionName(country) })}
                </p>
                <h2 className="mt-2 font-display text-3xl leading-tight font-extrabold text-paper sm:text-4xl">{top.title}</h2>
                <p className="mt-1 text-lg text-dust">
                  <ArtistLinks names={top.artist} />
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={playerTracks.length === 0}
                    onClick={() => player.playList(playerTracks, 0)}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40"
                  >
                    <Play className="size-4 fill-current" />
                    {t('discover.playAll')}
                  </button>
                  <button
                    type="button"
                    disabled={playerTracks.length === 0}
                    onClick={() => player.playList(playerTracks, 0, { shuffle: true })}
                    className="inline-flex items-center gap-2 rounded-xl bg-raised px-5 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-40"
                  >
                    <Shuffle className="size-4" />
                    {t('discover.shuffle')}
                  </button>
                </div>
                <p className="mt-3 text-xs text-fade">{t('discover.previewNote')}</p>
              </div>
            </div>
          </section>

          {data.albums.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-xl font-bold text-paper">{t('discover.albums')}</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
                {data.albums.slice(0, 12).map((a) => (
                  <AlbumCard key={a.id} album={a} onOpen={() => onOpen(a.url)} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-display text-xl font-bold text-paper">{t('discover.topSongs')}</h2>
            <ol className="space-y-0.5">
              {visible.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={i}
                  onPlay={() => playFrom(track)}
                  onAdd={() => void add(track)}
                  added={added.has(track.id)}
                />
              ))}
            </ol>
            {!showAll && data.tracks.length > FIRST_PAGE && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-4 w-full rounded-xl bg-panel py-3 font-semibold text-dust ring-1 ring-rule transition hover:text-paper hover:ring-dust"
              >
                {t('results.showMore', { count: data.tracks.length - FIRST_PAGE })}
              </button>
            )}
          </section>
        </div>
      )}

      {data && !top && !loading && <p className="py-16 text-center text-dust">{t('discover.empty')}</p>}
    </div>
  );
}
