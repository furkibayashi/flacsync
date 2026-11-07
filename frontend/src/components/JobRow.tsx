import clsx from 'clsx';
import { AlertCircle, Check, Disc3, Download, FolderOpen, RotateCcw, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { codecLabel, formatBytes, PLATFORM_LABEL } from '../lib/format';
import { formatSeconds } from '../lib/time';
import { api, isDesktopApp, revealSavedFile } from '../services/api';
import { useQueue } from '../state/QueueProvider';
import type { DownloadJob, JobStatus } from '../types/api';

const STAGES: JobStatus[] = ['resolving', 'downloading', 'converting', 'tagging'];

function StageDots({ status }: { status: JobStatus }) {
  const current = STAGES.indexOf(status);
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={clsx(
            'h-1 w-3 rounded-full transition-colors',
            status === 'completed' || i < current ? 'bg-amber' : i === current ? 'animate-pulse bg-amber/70' : 'bg-rule',
          )}
        />
      ))}
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Sıradaki tek bir indirme: kapak, durum, ilerleme, ayrıntılar ve işlemler. */
export function JobRow({ job, compact = false }: { job: DownloadJob; compact?: boolean }) {
  const { t, tError, lang } = useI18n();
  const { cancel, retry } = useQueue();
  const meta = job.metadata;
  const active = !['queued', 'completed', 'failed', 'cancelled'].includes(job.status);
  const done = job.status === 'completed';
  const failed = job.status === 'failed';
  const cancelled = job.status === 'cancelled';

  const details: string[] = [];
  if (job.source) details.push(codecLabel(job.source.format));
  if (done && job.file) details.push(formatBytes(job.file.size));
  if (done && job.timings) details.push(t('queue.tookTime', { time: formatSeconds(job.timings.total, lang) }));
  if (job.platform) details.push(PLATFORM_LABEL[job.platform]);

  return (
    <div
      className={clsx(
        'group grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-3 transition',
        compact ? 'rounded-lg hover:bg-raised/60' : 'hover:bg-panel/70',
        cancelled && 'opacity-55',
      )}
    >
      <span className="relative size-11 overflow-hidden rounded-md bg-raised">
        {meta?.coverUrl ? (
          <img src={meta.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Disc3 className={clsx('m-2.5 size-6 text-fade', active && 'animate-spin [animation-duration:3s]')} />
        )}
        {done && (
          <span className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-amber text-on-accent">
            <Check className="size-3" strokeWidth={3.5} />
          </span>
        )}
      </span>

      <div className="min-w-0 space-y-1">
        <p className="truncate text-[15px] font-medium text-paper">
          {meta?.title ?? <span className="text-dust">{hostOf(job.url)}</span>}
          {meta?.artist && <span className="font-normal text-dust"> · {meta.artist}</span>}
        </p>

        {active || job.status === 'queued' ? (
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs font-medium text-amber">{t(`status.${job.status}` as const)}</span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-rule">
              <span className="block h-full rounded-full bg-amber transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
            </span>
            <span className="w-9 shrink-0 text-right text-xs text-dust tabular-nums">{job.progress}%</span>
            {!compact && <StageDots status={job.status} />}
          </div>
        ) : failed ? (
          <p className="flex items-start gap-1.5 text-xs text-danger" title={job.error?.message}>
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2">{job.error ? tError(job.error.code, job.error.message) : t('status.failed')}</span>
          </p>
        ) : (
          <p className="truncate text-xs text-fade">
            {cancelled ? t('status.cancelled') : [job.format.toUpperCase(), ...details].join('  ·  ')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {(active || job.status === 'queued') && (
          <button
            type="button"
            onClick={() => void cancel(job.id)}
            title={t('queue.cancel')}
            aria-label={t('queue.cancelAria', { title: meta?.title ?? hostOf(job.url) })}
            className="grid size-8 place-items-center rounded-lg text-fade transition hover:bg-raised hover:text-danger"
          >
            <X className="size-4" />
          </button>
        )}
        {(failed || cancelled) && (
          <button
            type="button"
            onClick={() => void retry(job.id)}
            title={t('queue.retry')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-dust transition hover:bg-raised hover:text-paper"
          >
            <RotateCcw className="size-3.5" />
            {!compact && t('queue.retry')}
          </button>
        )}
        {done && job.file && (
          isDesktopApp ? (
            <button
              type="button"
              onClick={() => revealSavedFile(job.id)}
              title={t('action.showInFolder')}
              className="grid size-8 place-items-center rounded-lg text-fade transition hover:bg-raised hover:text-amber"
            >
              <FolderOpen className="size-4" />
            </button>
          ) : (
            <a
              href={api.fileUrl(job.id)}
              download={job.file.name}
              title={t('action.saveFile')}
              className="grid size-8 place-items-center rounded-lg text-fade transition hover:bg-raised hover:text-amber"
            >
              <Download className="size-4" />
            </a>
          )
        )}
      </div>
    </div>
  );
}
