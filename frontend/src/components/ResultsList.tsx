import clsx from 'clsx';
import { AudioLines, Check, ChevronDown, Disc3, ListPlus, Loader2, Play, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePlayer, type PlayerTrack } from '../state/PlayerProvider';
import { useI18n } from '../i18n/I18nProvider';
import { ArtistLinks } from './ArtistLinks';
import { formatDuration, PLATFORM_DOT, PLATFORM_LABEL } from '../lib/format';
import type { OutputFormat, SearchResult } from '../types/api';

interface Props {
  results: SearchResult[];
  selectedId: string | null;
  onSelect: (result: SearchResult) => void;
  onAddToQueue: (results: SearchResult[]) => void;
  format: OutputFormat;
  onFormatChange: (format: OutputFormat) => void;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Aramanın diğer sonuçları. Satıra tıklamak şarkıyı açar; kutularla birden fazla şarkı
 * seçilip tek seferde sıraya eklenebilir, "+" tek şarkıyı hemen sıraya ekler.
 */
export function ResultsList({
  results,
  selectedId,
  onSelect,
  onAddToQueue,
  format,
  onFormatChange,
  canLoadMore,
  loadingMore,
  onLoadMore,
}: Props) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Yeni arama: seçimleri sıfırla
  const firstId = results[0]?.id;
  useEffect(() => {
    setPicked(new Set());
    setAdded(new Set());
  }, [firstId]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (list: SearchResult[]) => {
    onAddToQueue(list);
    setAdded((prev) => new Set([...prev, ...list.map((r) => r.id)]));
    setPicked(new Set());
  };

  const pickedResults = results.filter((r) => picked.has(r.id));

  // Kapağa tıklayınca 30 sn önizleme; sonraki / önceki listedeki diğer önizlemelere geçer
  const player = usePlayer();
  const previews = useMemo<PlayerTrack[]>(
    () =>
      results
        .filter((r) => r.previewUrl)
        .map((r) => ({
          id: `search:${r.id}`,
          title: r.title,
          artist: r.artist,
          album: r.album,
          coverUrl: r.coverUrl,
          src: r.previewUrl!,
          kind: 'preview',
          sourceUrl: r.url,
        })),
    [results],
  );
  const playPreview = (r: SearchResult) => {
    const id = `search:${r.id}`;
    if (player.current?.id === id) return player.toggle();
    player.playList(previews, previews.findIndex((p) => p.id === id));
  };

  return (
    <section aria-labelledby="other-results" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="other-results" className="font-display text-xl font-bold tracking-tight">
          {t('results.more')}
          <span className="ml-2 text-sm font-semibold text-fade tabular-nums">{results.length}</span>
        </h2>
        <p className="text-sm text-fade">{t('results.pickHint')}</p>
      </div>

      <ul className="divide-y divide-rule border-y border-rule">
        {results.map((r, index) => {
          const selected = r.id === selectedId;
          const isPicked = picked.has(r.id);
          const wasAdded = added.has(r.id);
          return (
            <li
              key={r.id}
              className={clsx(
                'group grid grid-cols-[auto_44px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 pr-2 pl-3 transition sm:grid-cols-[auto_44px_minmax(0,1fr)_auto_auto_auto]',
                selected ? 'bg-panel shadow-[inset_3px_0_0_var(--color-amber)]' : isPicked ? 'bg-amber/[0.06]' : 'hover:bg-panel/60',
              )}
            >
              <input
                type="checkbox"
                checked={isPicked}
                onChange={() => toggle(r.id)}
                aria-label={t('results.pick', { title: r.title })}
                className="size-4 accent-[var(--color-amber)]"
              />
              <button
                type="button"
                onClick={() => (r.previewUrl ? playPreview(r) : onSelect(r))}
                title={r.previewUrl ? t('track.previewPlay') : undefined}
                aria-label={r.previewUrl ? `${t('track.previewPlay')}: ${r.title}` : undefined}
                tabIndex={r.previewUrl ? 0 : -1}
                aria-hidden={r.previewUrl ? undefined : true}
                className="group/cover relative size-11 overflow-hidden rounded bg-raised"
              >
                {r.coverUrl ? (
                  <img src={r.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <Disc3 className="m-2.5 size-6 text-fade" />
                )}
                <span className="absolute top-0.5 left-0.5 rounded bg-night/80 px-1 text-[10px] font-bold text-dust tabular-nums">
                  {index + 1}
                </span>
                {r.previewUrl && (
                  <span
                    className={clsx(
                      'absolute inset-0 grid place-items-center bg-black/55 text-white transition',
                      player.current?.id === `search:${r.id}` ? 'opacity-100' : 'opacity-0 group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100',
                    )}
                  >
                    {player.current?.id === `search:${r.id}` && player.playing ? (
                      <AudioLines className="size-5 text-amber" />
                    ) : (
                      <Play className="size-4 fill-current" />
                    )}
                  </span>
                )}
              </button>
              {/* Başlık şarkıyı açar; sanatçı adları ayrı bağlantı (iç içe düğme olmasın diye) */}
              <div className="min-w-0 cursor-pointer" onClick={() => onSelect(r)}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(r);
                  }}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={t('results.choose', { title: r.title, artist: r.artist })}
                  className={clsx('block max-w-full truncate text-left font-medium', selected ? 'text-amber' : 'text-paper group-hover:text-paper')}
                >
                  {r.title}
                </button>
                <span className="block truncate text-sm text-dust">
                  <ArtistLinks names={r.artist} />
                  {r.album && <span className="text-fade">{`, ${r.album}`}</span>}
                </span>
              </div>
              <span className="hidden items-center gap-1 sm:flex" title={r.sources.map((s) => PLATFORM_LABEL[s]).join(', ')}>
                {r.sources.map((s) => (
                  <span key={s} className={clsx('size-2 rounded-full', PLATFORM_DOT[s])} />
                ))}
              </span>
              <span className="hidden text-right text-sm text-dust tabular-nums sm:block">
                {r.releaseYear && <span className="mr-3 hidden text-fade md:inline">{r.releaseYear}</span>}
                {formatDuration(r.duration)}
              </span>
              <button
                type="button"
                onClick={() => add([r])}
                disabled={wasAdded}
                title={wasAdded ? t('results.added') : t('results.addToQueue')}
                aria-label={t('results.addAria', { title: r.title })}
                className={clsx(
                  'grid size-9 place-items-center rounded-lg transition',
                  wasAdded ? 'text-amber' : 'text-fade opacity-80 group-hover:opacity-100 hover:bg-raised hover:text-amber',
                )}
              >
                {wasAdded ? <Check className="size-4" strokeWidth={3} /> : <Plus className="size-4" />}
              </button>
            </li>
          );
        })}
      </ul>

      {canLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mx-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-dust ring-1 ring-rule transition hover:bg-panel hover:text-paper disabled:opacity-60"
        >
          {loadingMore ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
          {t('results.showMore')}
        </button>
      )}

      {pickedResults.length > 0 && (
        <div className="sticky bottom-20 z-20 md:bottom-6">
          <div className="animate-rise mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl bg-raised/95 p-3 pl-5 shadow-2xl shadow-black/50 ring-1 ring-amber/40 backdrop-blur">
            <span className="font-semibold text-paper">{t('results.pickedCount', { count: pickedResults.length })}</span>
            <span className="ml-auto flex rounded-lg bg-night/60 p-0.5" role="group" aria-label={t('format.legend')}>
              {(['mp3', 'flac'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={format === f}
                  onClick={() => onFormatChange(f)}
                  className={clsx('rounded-md px-3 py-1 text-xs font-bold', format === f ? 'bg-paper text-night' : 'text-dust hover:text-paper')}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </span>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="rounded-lg px-3 py-2 text-sm text-dust transition hover:text-paper"
            >
              {t('results.clearPick')}
            </button>
            <button
              type="button"
              onClick={() => add(pickedResults)}
              className="inline-flex items-center gap-2 rounded-xl bg-amber px-4 py-2 font-display font-bold text-on-accent transition hover:bg-amber-hi"
            >
              <ListPlus className="size-4" />
              {t('results.addPicked')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
