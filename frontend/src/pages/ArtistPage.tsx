import clsx from 'clsx';
import { ArrowLeft, Bell, BellRing, Check, Disc3, Download, Loader2, Mic2, Play, Plus, Shuffle, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RowPlayButton } from '../components/PlayButton';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { useI18n } from '../i18n/I18nProvider';
import { formatDuration } from '../lib/format';
import { formatNumber } from '../lib/time';
import { api, isAbort, toUiError, type UiError } from '../services/api';
import { usePlayer, type PlayerTrack } from '../state/PlayerProvider';
import { useQueue } from '../state/QueueProvider';
import { useFollows } from '../state/follows';
import { openArtist } from '../state/router';
import type { ArtistAlbum, ArtistProfile, ArtistTrack } from '../types/api';

type AlbumTab = 'album' | 'single' | 'compilation';
const FIRST_TRACKS = 10;

const toPlayerTrack = (t: ArtistTrack): PlayerTrack => ({
  id: `artist:${t.id}`,
  title: t.title,
  artist: t.artist,
  album: t.album,
  coverUrl: t.coverUrl,
  src: t.previewUrl ?? '',
  kind: 'preview',
  sourceUrl: t.url,
  duration: t.duration,
});

function AlbumTile({ album, onOpen }: { album: ArtistAlbum; onOpen: () => void }) {
  const { t } = useI18n();
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
          <Disc3 className="absolute inset-0 m-auto size-1/3 text-fade" strokeWidth={1.25} />
        )}
      </span>
      <span className="mt-2.5 block truncate font-semibold text-paper group-hover:text-amber">{album.title}</span>
      <span className="block truncate text-sm text-dust">
        {album.releaseYear ?? ''}
        {album.releaseYear ? ' · ' : ''}
        {t(`artist.type.${album.type}` as 'artist.type.album')}
      </span>
    </button>
  );
}

export function ArtistPage({ id, onOpen, onBack }: { id: string | null; onOpen: (url: string) => void; onBack: () => void }) {
  const { t, lang } = useI18n();
  const player = usePlayer();
  const queue = useQueue();
  const [format] = usePreferredFormat();
  const [data, setData] = useState<ArtistProfile | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<AlbumTab>('album');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [bulkAdded, setBulkAdded] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const follows = useFollows();

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setShowAll(false);
    setAdded(new Set());
    setBulkAdded(false);
    setPictureFailed(false);
    api
      .artist(id, controller.signal)
      .then((profile) => {
        setData(profile);
        // İlk sekme: albüm yoksa tekliler
        setTab(profile.albums.some((a) => a.type === 'album') ? 'album' : 'single');
      })
      .catch((err) => !isAbort(err) && setError(toUiError(err)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [id]);

  const previews = useMemo(() => (data?.topTracks ?? []).filter((x) => x.previewUrl).map(toPlayerTrack), [data]);
  const albumsByTab = useMemo(() => {
    const all = data?.albums ?? [];
    return {
      album: all.filter((a) => a.type === 'album'),
      single: all.filter((a) => a.type === 'single' || a.type === 'ep'),
      compilation: all.filter((a) => a.type === 'compilation'),
    } satisfies Record<AlbumTab, ArtistAlbum[]>;
  }, [data]);

  const playFrom = (track: ArtistTrack) => {
    const pid = `artist:${track.id}`;
    if (player.current?.id === pid) return player.toggle();
    const start = previews.findIndex((p) => p.id === pid);
    if (start >= 0) player.playList(previews, start);
  };

  const add = async (track: ArtistTrack) => {
    if (await queue.enqueue(track.url, format)) setAdded((s) => new Set(s).add(track.id));
  };

  const addAllTop = async () => {
    if (!data) return;
    const list = data.topTracks.slice(0, showAll ? undefined : FIRST_TRACKS);
    const batch = await queue.enqueueBatch(
      t('artist.topBatch', { name: data.artist.name }),
      format,
      list.map((x) => ({ url: x.url })),
      true,
    );
    if (batch) {
      setBulkAdded(true);
      setAdded(new Set(list.map((x) => x.id)));
    }
  };

  if (!id) return null;

  if (loading && !data) {
    return (
      <div className="grid place-items-center py-32 text-dust">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-danger">{error?.message ?? t('artist.notFound')}</p>
        <button type="button" onClick={onBack} className="font-semibold text-amber hover:text-amber-hi">
          {t('artist.back')}
        </button>
      </div>
    );
  }

  const { artist } = data;
  const following = follows.isFollowing(artist.id);
  const visible = showAll ? data.topTracks : data.topTracks.slice(0, FIRST_TRACKS);
  const tabs = (['album', 'single', 'compilation'] as const).filter((k) => albumsByTab[k].length > 0);

  return (
    <div className={clsx('animate-rise space-y-10 pb-8 transition-opacity', loading && 'opacity-60')}>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-dust hover:text-paper">
        <ArrowLeft className="size-4" />
        {t('artist.back')}
      </button>

      {/* Başlık */}
      <section className="relative overflow-hidden rounded-3xl bg-panel ring-1 ring-rule">
        {artist.pictureUrl && !pictureFailed && (
          <img src={artist.pictureUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-2xl" />
        )}
        <div className="relative flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:items-end sm:p-8 sm:text-left">
          <span className="relative grid size-40 shrink-0 place-items-center overflow-hidden rounded-full bg-raised shadow-2xl shadow-black/50 ring-4 ring-night/40 sm:size-48">
            {artist.pictureUrl && !pictureFailed ? (
              <img src={artist.pictureUrl} alt="" className="size-full object-cover" onError={() => setPictureFailed(true)} />
            ) : (
              <UserRound className="size-1/2 text-fade" strokeWidth={1.25} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center justify-center gap-1.5 text-sm font-bold tracking-wide text-amber uppercase sm:justify-start">
              <Mic2 className="size-4" />
              {t('artist.label')}
            </p>
            <h1 className="mt-1 font-display text-4xl leading-tight font-extrabold tracking-tight text-balance break-words text-paper sm:text-6xl">
              {artist.name}
            </h1>
            <p className="mt-2 text-dust">
              {artist.fans !== null && t('artist.fans', { count: formatNumber(artist.fans, lang) })}
              {artist.fans !== null && artist.albumCount ? ' · ' : ''}
              {artist.albumCount ? t('artist.albumCount', { count: artist.albumCount }) : ''}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
              <button
                type="button"
                disabled={previews.length === 0}
                onClick={() => player.playList(previews, 0)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-40"
              >
                <Play className="size-4 fill-current" />
                {t('artist.play')}
              </button>
              <button
                type="button"
                disabled={previews.length === 0}
                onClick={() => player.playList(previews, 0, { shuffle: true })}
                className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-40"
              >
                <Shuffle className="size-4" />
                {t('player.shuffle')}
              </button>
              <button
                type="button"
                onClick={() => void follows.toggle({ id: artist.id, name: artist.name, pictureUrl: artist.pictureUrl })}
                aria-pressed={following}
                title={following ? t('follow.unfollowHint') : t('follow.followHint')}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-semibold ring-1 transition',
                  following ? 'bg-amber/15 text-amber ring-amber/50 hover:bg-amber/25' : 'bg-raised text-paper ring-rule hover:ring-dust',
                )}
              >
                {following ? <BellRing className="size-4" /> : <Bell className="size-4" />}
                {following ? t('follow.following') : t('follow.follow')}
              </button>
              <button
                type="button"
                disabled={bulkAdded || data.topTracks.length === 0}
                onClick={() => void addAllTop()}
                className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-50"
              >
                {bulkAdded ? <Check className="size-4 text-ok" /> : <Download className="size-4" />}
                {bulkAdded
                  ? t('results.added')
                  : t('artist.downloadTop', { count: Math.min(visible.length, data.topTracks.length) })}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Popüler şarkılar */}
      {data.topTracks.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-bold text-paper">{t('artist.popular')}</h2>
          <ol className="space-y-0.5">
            {visible.map((track, i) => {
              const active = player.current?.id === `artist:${track.id}`;
              const wasAdded = added.has(track.id);
              return (
                <li
                  key={track.id}
                  className={clsx('group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised/60 sm:gap-4 sm:px-3', active && 'bg-raised/70')}
                >
                  <span className="w-6 shrink-0 text-right text-sm text-fade tabular-nums">{i + 1}</span>
                  <span className="size-11 shrink-0 overflow-hidden rounded-md bg-raised">
                    {track.coverUrl && <img src={track.coverUrl} alt="" loading="lazy" className="size-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block truncate font-semibold', active ? 'text-amber' : 'text-paper')}>{track.title}</span>
                    <span className="block truncate text-sm text-dust">{track.album}</span>
                  </span>
                  <span className="hidden w-12 text-right text-sm text-fade tabular-nums sm:block">{formatDuration(track.duration)}</span>
                  <RowPlayButton active={active} playing={active && player.playing} onClick={() => playFrom(track)} disabled={!track.previewUrl} />
                  <button
                    type="button"
                    onClick={() => void add(track)}
                    disabled={wasAdded}
                    title={wasAdded ? t('results.added') : t('results.addToQueue')}
                    aria-label={wasAdded ? t('results.added') : t('results.addAria', { title: track.title })}
                    className={clsx(
                      'grid size-9 shrink-0 place-items-center rounded-full ring-1 transition',
                      wasAdded ? 'text-ok ring-ok/40' : 'text-dust ring-rule hover:text-paper hover:ring-dust',
                    )}
                  >
                    {wasAdded ? <Check className="size-4" /> : <Plus className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ol>
          {!showAll && data.topTracks.length > FIRST_TRACKS && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 w-full rounded-xl bg-panel py-3 font-semibold text-dust ring-1 ring-rule transition hover:text-paper hover:ring-dust"
            >
              {t('results.showMore')}
            </button>
          )}
        </section>
      )}

      {/* Diskografi */}
      {tabs.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-paper">{t('artist.discography')}</h2>
            <div role="group" className="inline-flex rounded-xl bg-panel p-1 ring-1 ring-rule">
              {tabs.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tab === k}
                  onClick={() => setTab(k)}
                  className={clsx(
                    'rounded-lg px-3.5 py-1.5 text-sm font-semibold transition',
                    tab === k ? 'bg-paper text-night' : 'text-dust hover:text-paper',
                  )}
                >
                  {t(`artist.tab.${k}` as 'artist.tab.album')} <span className="ml-0.5 text-xs opacity-60">{albumsByTab[k].length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
            {albumsByTab[tab].map((a) => (
              <AlbumTile key={a.id} album={a} onOpen={() => onOpen(a.url)} />
            ))}
          </div>
        </section>
      )}

      {/* Benzer sanatçılar */}
      {data.related.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-xl font-bold text-paper">{t('artist.related')}</h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {data.related.map((r) => (
              <button key={r.id} type="button" onClick={() => openArtist(r.id)} className="group text-center">
                <span className="mx-auto grid aspect-square w-full max-w-32 place-items-center overflow-hidden rounded-full bg-raised ring-1 ring-rule transition group-hover:ring-amber">
                  {r.pictureUrl ? (
                    <img src={r.pictureUrl} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <UserRound className="size-1/2 text-fade" strokeWidth={1.25} />
                  )}
                </span>
                <span className="mt-2 block truncate text-sm font-semibold text-paper group-hover:text-amber">{r.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
