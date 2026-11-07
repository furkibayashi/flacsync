import clsx from 'clsx';
import { AlertCircle, AudioLines, Check, Download, FolderOpen, Loader2, Play, RotateCcw, Shuffle } from 'lucide-react';
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { usePlayer, type PlayerTrack } from '../state/PlayerProvider';
import { isTerminal, useQueue } from '../state/QueueProvider';
import { useI18n } from '../i18n/I18nProvider';
import { ArtistLinks } from './ArtistLinks';
import { formatDuration } from '../lib/format';
import { api, isDesktopApp, openSaveFolder, revealSavedFile } from '../services/api';
import type { BatchItem, Collection, CollectionTrack, DownloadJob, OutputFormat } from '../types/api';

/**
 * Bu albümün indirmeleri, global sıranın üzerinde: parça linki → iş eşlemesi burada tutulur,
 * ilerleme ve kaydetme QueueProvider'dan gelir (sayfa değişince kopmaz).
 */
function useCollectionDownloads() {
  const { jobs, batches, enqueueBatch, error } = useQueue();
  const [jobIdByUrl, setJobIdByUrl] = useState<Record<string, string>>({});
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [lastBulkId, setLastBulkId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(
    async (name: string, format: OutputFormat, items: BatchItem[], { bulk }: { bulk: boolean }) => {
      setStarting(true);
      const batch = await enqueueBatch(name, format, items, true);
      setStarting(false);
      if (!batch) return;
      setJobIdByUrl((prev) => {
        const next = { ...prev };
        items.forEach((item, i) => {
          const id = batch.jobIds[i];
          if (id) next[item.url] = id;
        });
        return next;
      });
      setBatchIds((prev) => [...prev, batch.id]);
      if (bulk) setLastBulkId(batch.id);
    },
    [enqueueBatch],
  );

  const jobForUrl = useCallback((url: string) => jobs[jobIdByUrl[url] ?? ''] ?? null, [jobs, jobIdByUrl]);
  const lastBulk = lastBulkId ? batches[lastBulkId] ?? null : null;
  const running = batchIds.some((id) => batches[id]?.status === 'running');
  const anyActive = Object.values(jobIdByUrl).some((id) => jobs[id] && !isTerminal(jobs[id]));

  return {
    start,
    jobForUrl,
    error,
    isRunning: starting || running || anyActive,
    bulkRunning: starting || lastBulk?.status === 'running',
    lastBulk,
  };
}
import { FormatPicker } from './FormatPicker';
import { PlatformTag } from './PlatformTag';
import { Sleeve } from './Sleeve';

interface Props {
  collection: Collection;
  onReset: () => void;
}

function RowStatus({ job, title, onDownload }: { job: DownloadJob | null; title: string; onDownload: () => void }) {
  const { t, tError } = useI18n();

  if (!job || job.status === 'failed') {
    const failed = job?.status === 'failed';
    return (
      <span className="inline-flex items-center gap-2">
        {failed && (
          <span
            className="inline-flex items-center gap-1.5 text-sm text-danger"
            title={job.error ? tError(job.error.code, job.error.message) : undefined}
          >
            <AlertCircle className="size-4" />
            {t('collection.rowFailed')}
          </span>
        )}
        <button
          type="button"
          onClick={onDownload}
        aria-label={t('collection.downloadOne', { title })}
        title={t('collection.downloadOne', { title })}
          className="grid size-9 place-items-center rounded-lg text-fade opacity-70 transition group-hover:opacity-100 hover:bg-raised hover:text-amber"
        >
          {failed ? <RotateCcw className="size-4" /> : <Download className="size-4" />}
        </button>
      </span>
    );
  }
  if (job.status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-amber">
        <Check className="size-4" strokeWidth={3} />
        {isDesktopApp ? (
          <button
            type="button"
            onClick={() => revealSavedFile(job.id)}
            title={t('action.showInFolder')}
            className="underline-offset-4 hover:underline"
          >
            {t('collection.rowDone')}
          </button>
        ) : job.file ? (
          <a href={api.fileUrl(job.id)} download={job.file.name} className="underline-offset-4 hover:underline">
            {t('collection.rowDone')}
          </a>
        ) : (
          t('collection.rowDone')
        )}
      </span>
    );
  }
  if (job.status === 'queued') return <span className="text-sm text-fade">{t('collection.rowQueued')}</span>;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-dust tabular-nums">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-rule" aria-hidden>
        <span className="block h-full bg-amber transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
      </span>
      {job.progress}%
    </span>
  );
}

/**
 * Albüm / çalma listesi: tümünü, seçilenleri ya da tek parçayı indir.
 * Albümlerde parça numarası, albüm adı, yılı, kapağı ve albüm sanatçısı her dosyaya ortak yazılır.
 */
export function CollectionView({ collection, onReset }: Props) {
  const { t, tError } = useI18n();
  const [format, setFormat] = usePreferredFormat();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(collection.tracks.map((tr) => tr.url)));
  const downloads = useCollectionDownloads();

  const isAlbum = collection.type === 'album';
  const folder = isAlbum && collection.artist ? `${collection.artist} - ${collection.title}` : collection.title;
  const totalSeconds = collection.tracks.reduce((sum, tr) => sum + (tr.duration ?? 0), 0);
  const allSelected = selected.size === collection.tracks.length;
  const multiDisc = useMemo(() => new Set(collection.tracks.map((tr) => tr.disc ?? 1)).size > 1, [collection.tracks]);

  // Oynatıcı: platformun 30 sn önizlemeleri (Deezer / Apple / Spotify), albüm sırasıyla
  const player = usePlayer();
  const previews = useMemo<PlayerTrack[]>(
    () =>
      collection.tracks
        .filter((tr) => tr.previewUrl)
        .map((tr) => ({
          id: `col:${tr.url}`,
          title: tr.title,
          artist: tr.artist,
          album: collection.title,
          coverUrl: collection.coverUrl,
          src: tr.previewUrl!,
          kind: 'preview',
          sourceUrl: tr.url,
        })),
    [collection],
  );
  const playingHere = previews.some((p) => p.id === player.current?.id);
  const playTrack = (track: CollectionTrack) => {
    const id = `col:${track.url}`;
    if (player.current?.id === id) return player.toggle();
    player.playList(previews, previews.findIndex((p) => p.id === id));
  };

  const toItem = (track: CollectionTrack): BatchItem =>
    isAlbum
      ? {
          url: track.url,
          overrides: {
            album: collection.title,
            ...(collection.releaseYear ? { releaseDate: collection.releaseYear } : {}),
            ...(collection.coverUrl ? { coverUrl: collection.coverUrl } : {}),
          },
          extras: {
            trackNumber: track.position,
            trackTotal: collection.totalTracks,
            ...(track.disc ? { discNumber: track.disc } : {}),
            ...(collection.artist ? { albumArtist: collection.artist } : {}),
          },
        }
      : { url: track.url };

  // Zaten inmiş ya da inmekte olan parçalar tekrar kuyruğa girmez (başarısız olanlar yeniden denenir)
  const pending = collection.tracks.filter((tr) => {
    const job = downloads.jobForUrl(tr.url);
    return selected.has(tr.url) && (!job || job.status === 'failed');
  });
  const downloadSelected = () => {
    if (pending.length > 0) void downloads.start(folder, format, pending.map(toItem), { bulk: true });
  };
  const downloadOne = (track: CollectionTrack) => void downloads.start(folder, format, [toItem(track)], { bulk: false });

  const toggle = (url: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  const bulk = downloads.lastBulk;
  const facts: Array<[string, string]> = [
    [t('track.year'), collection.releaseYear ?? ''],
    [t('collection.trackCount'), String(collection.totalTracks)],
    [t('collection.length'), totalSeconds ? t('collection.minutes', { min: Math.round(totalSeconds / 60) }) : ''],
  ].filter((f): f is [string, string] => Boolean(f[1]));

  return (
    <div className="space-y-12">
      <section
        className="animate-rise grid gap-10 md:grid-cols-[auto_minmax(0,1fr)] md:gap-12"
        style={{ '--cover': 'clamp(220px, 30vw, 330px)' } as CSSProperties}
      >
        <div className="flex justify-center md:block">
          <Sleeve
            coverUrl={collection.coverUrl}
            alt={t('track.cover', { album: collection.title })}
            spinning={downloads.isRunning}
            preview={null}
          />
        </div>

        <div className="min-w-0 space-y-8">
          <div>
            <p className="mb-2 text-sm font-medium text-amber">
              {isAlbum ? t('collection.album') : t('collection.playlist')}
            </p>
            <h2 className="font-display text-3xl leading-[1.05] font-extrabold tracking-[-0.03em] text-balance hyphens-auto sm:text-4xl xl:text-6xl">
              {collection.title}
            </h2>
            {collection.artist && (
              <p className="mt-3 text-xl text-dust">
                <ArtistLinks names={collection.artist} />
              </p>
            )}
            {previews.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => (playingHere ? player.toggle() : player.playList(previews, 0))}
                  className="inline-flex items-center gap-2 rounded-full bg-paper px-5 py-2.5 font-display font-bold text-night transition hover:scale-[1.03]"
                >
                  {playingHere && player.playing ? <AudioLines className="size-4" /> : <Play className="size-4 fill-current" />}
                  {playingHere && player.playing ? t('player.pause') : t('collection.listen')}
                </button>
                <button
                  type="button"
                  onClick={() => player.playList(previews, 0, { shuffle: true })}
                  title={t('player.shuffle')}
                  className="inline-flex items-center gap-2 rounded-full bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust"
                >
                  <Shuffle className="size-4" />
                  {t('player.shuffle')}
                </button>
                <span className="text-sm text-fade">{t('collection.previewNote', { count: previews.length })}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <p className="text-sm text-fade">{label}</p>
                <p className="text-[15px] text-paper tabular-nums">{value}</p>
              </div>
            ))}
            <div>
              <p className="text-sm text-fade">{t('track.foundOn')}</p>
              <PlatformTag platform={collection.platform} />
            </div>
          </div>

          <div className="space-y-5 border-t border-rule pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <FormatPicker value={format} onChange={setFormat} disabled={downloads.isRunning} />
              <button
                type="button"
                onClick={downloadSelected}
                disabled={pending.length === 0 || downloads.bulkRunning}
                className="inline-flex h-[62px] items-center gap-2.5 rounded-xl bg-amber px-7 font-display text-lg font-bold text-on-accent transition hover:bg-amber-hi disabled:cursor-not-allowed disabled:opacity-40"
              >
                {downloads.bulkRunning ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" strokeWidth={2.5} />}
                {downloads.bulkRunning
                  ? t('status.downloading')
                  : allSelected
                    ? t('collection.downloadAll', { count: pending.length })
                    : t('collection.downloadSelected', { count: pending.length })}
              </button>
              <button
                type="button"
                onClick={onReset}
                className="inline-flex h-[62px] items-center gap-2 rounded-xl px-4 text-[15px] text-dust transition hover:bg-panel hover:text-paper"
              >
                <RotateCcw className="size-4" />
                {t('action.newSong')}
              </button>
            </div>

            {bulk && (
              <div className="max-w-xl space-y-2" aria-live="polite">
                <div className="flex items-baseline justify-between gap-4 text-[15px]">
                  <span className="font-medium text-paper">
                    {t('collection.progress', { done: bulk.completed, total: bulk.total })}
                  </span>
                  <span className="text-dust tabular-nums">{bulk.progress}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={bulk.progress}
                  aria-label={t('collection.progress', { done: bulk.completed, total: bulk.total })}
                  className="h-1.5 overflow-hidden rounded-full bg-rule"
                >
                  <div className="h-full rounded-full bg-amber transition-[width] duration-500" style={{ width: `${Math.max(bulk.progress, 2)}%` }} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm">
                  {bulk.failed > 0 && <span className="text-danger">{t('collection.failed', { count: bulk.failed })}</span>}
                  {isDesktopApp ? (
                    <>
                      <span className="text-fade">{t('collection.savedTo', { folder: bulk.folder ?? collection.title })}</span>
                      <button
                        type="button"
                        onClick={() => openSaveFolder(bulk.folder ?? undefined)}
                        className="inline-flex items-center gap-1.5 font-semibold text-amber underline-offset-4 hover:underline"
                      >
                        <FolderOpen className="size-4" />
                        {t('collection.openFolder')}
                      </button>
                    </>
                  ) : (
                    bulk.status !== 'running' &&
                    bulk.completed > 0 && (
                      <a href={api.batchZipUrl(bulk.id)} className="font-semibold text-amber underline-offset-4 hover:underline">
                        {t('collection.saveZip')}
                      </a>
                    )
                  )}
                </div>
              </div>
            )}

            {downloads.error && (
              <p className="flex items-start gap-2 text-sm text-danger" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {tError(downloads.error.code, downloads.error.message)}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-label={collection.title}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-3 pl-3 text-sm text-dust">
            <input
              type="checkbox"
              aria-label={t('collection.selectAll')}
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && !allSelected;
              }}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(collection.tracks.map((tr) => tr.url)))
              }
              className="size-4 accent-[var(--color-amber)]"
            />
            {t('collection.selectAll')}
          </label>
          <span className="text-sm text-fade">
            {t('collection.selection', { count: selected.size, total: collection.tracks.length })}
          </span>
        </div>

        {collection.totalTracks > collection.tracks.length && (
          <p className="pl-3 text-sm text-fade">
            {t('collection.truncated', { total: collection.totalTracks, count: collection.tracks.length })}
          </p>
        )}

        <ol className="divide-y divide-rule border-y border-rule">
          {collection.tracks.map((track) => {
            const job = downloads.jobForUrl(track.url);
            const checked = selected.has(track.url);
            const showArtist = !isAlbum || (collection.artist !== null && track.artist !== collection.artist);
            return (
              <li
                key={`${track.disc ?? 1}-${track.position}-${track.url}`}
                className={clsx(
                  'group grid grid-cols-[auto_2.25rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 pr-2 pl-3 transition sm:grid-cols-[auto_2.25rem_minmax(0,1fr)_auto_7rem]',
                  checked ? 'hover:bg-panel/60' : 'opacity-60 hover:opacity-100',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(track.url)}
                  aria-label={track.title}
                  className="size-4 accent-[var(--color-amber)]"
                />
                {(() => {
                  const id = `col:${track.url}`;
                  const active = player.current?.id === id;
                  const number = (
                    <>
                      {multiDisc && track.disc ? `${track.disc}.` : ''}
                      {track.position}
                    </>
                  );
                  if (!track.previewUrl) return <span className="text-right text-sm text-fade tabular-nums">{number}</span>;
                  return (
                    <button
                      type="button"
                      onClick={() => playTrack(track)}
                      title={active && player.playing ? t('player.pause') : t('track.previewPlay')}
                      aria-label={`${active && player.playing ? t('player.pause') : t('player.play')}: ${track.title}`}
                      className={clsx('flex h-7 items-center justify-end text-sm tabular-nums', active ? 'text-amber' : 'text-fade')}
                    >
                      {active && player.playing ? (
                        <AudioLines className="size-4" />
                      ) : (
                        <>
                          <span className="group-hover:hidden">{number}</span>
                          <Play className="hidden size-4 fill-current text-paper group-hover:block" />
                        </>
                      )}
                    </button>
                  );
                })()}
                <span className="min-w-0">
                  <span className={clsx('block truncate', player.current?.id === `col:${track.url}` ? 'text-amber' : 'text-paper')}>{track.title}</span>
                  {showArtist && <ArtistLinks names={track.artist} className="block truncate text-sm text-dust" />}
                </span>
                <span className="hidden text-sm text-dust tabular-nums sm:block">{formatDuration(track.duration)}</span>
                <span className="flex justify-end">
                  <RowStatus
                    job={job}
                    title={track.title}
                    onDownload={() => downloadOne(track)}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
