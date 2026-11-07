import clsx from 'clsx';
import { FolderOpen, Inbox, ListMusic, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { JobRow } from '../components/JobRow';
import { useI18n } from '../i18n/I18nProvider';
import { isDesktopApp, openSaveFolder } from '../services/api';
import { isTerminal, useQueue } from '../state/QueueProvider';
import type { Route } from '../state/router';
import type { Batch, DownloadJob } from '../types/api';

type Filter = 'all' | 'active' | 'done' | 'problem';

const matches = (job: DownloadJob, filter: Filter) =>
  filter === 'all' ||
  (filter === 'active' && !isTerminal(job)) ||
  (filter === 'done' && job.status === 'completed') ||
  (filter === 'problem' && (job.status === 'failed' || job.status === 'cancelled'));

interface Group {
  key: string;
  batch: Batch | null;
  jobs: DownloadJob[];
  latest: string;
}

function BatchHeader({ batch }: { batch: Batch }) {
  const { t } = useI18n();
  const running = batch.status === 'running';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-3 py-3">
      <ListMusic className="size-5 shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold">{batch.name}</p>
        <p className="text-xs text-fade">
          {t('collection.progress', { done: batch.completed, total: batch.total })}
          {batch.failed > 0 && <span className="text-danger">{`  ·  ${t('collection.failed', { count: batch.failed })}`}</span>}
          {batch.cancelled > 0 && `  ·  ${t('queue.cancelledCount', { count: batch.cancelled })}`}
          {`  ·  ${batch.format.toUpperCase()}`}
        </p>
      </div>
      {running && (
        <span className="flex w-40 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-rule">
            <span className="block h-full bg-amber transition-[width] duration-500" style={{ width: `${batch.progress}%` }} />
          </span>
          <span className="text-xs text-dust tabular-nums">{batch.progress}%</span>
        </span>
      )}
      {isDesktopApp && batch.folder && (
        <button
          type="button"
          onClick={() => openSaveFolder(batch.folder ?? undefined)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-dust transition hover:bg-raised hover:text-paper"
        >
          <FolderOpen className="size-3.5" />
          {t('collection.openFolder')}
        </button>
      )}
    </div>
  );
}

export function QueuePage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t } = useI18n();
  const { jobs, batches, order, stats, clearFinished } = useQueue();
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const id of order) {
      const job = jobs[id];
      if (!job || !matches(job, filter)) continue;
      const batch = job.batchId ? batches[job.batchId] ?? null : null;
      // Tek parçalık toplu işler (albümden tek şarkı) tek şarkı gibi gösterilir
      const key = batch && batch.total > 1 ? batch.id : 'singles';
      const group = map.get(key) ?? { key, batch: key === 'singles' ? null : batch, jobs: [], latest: job.createdAt };
      group.jobs.push(job);
      if (job.updatedAt > group.latest) group.latest = job.updatedAt;
      map.set(key, group);
    }
    // Albüm içi sıra: parça sırası; gruplar: en son hareket önce
    for (const g of map.values()) {
      if (g.batch) g.jobs.sort((a, b) => g.batch!.jobIds.indexOf(a.id) - g.batch!.jobIds.indexOf(b.id));
    }
    return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest));
  }, [jobs, batches, order, filter]);

  const filters: Array<{ key: Filter; label: string; count: number }> = [
    { key: 'all', label: t('queue.filterAll'), count: order.length },
    { key: 'active', label: t('queue.filterActive'), count: stats.active + stats.queued },
    { key: 'done', label: t('queue.filterDone'), count: stats.completed },
    { key: 'problem', label: t('queue.filterProblem'), count: stats.failed + stats.cancelled },
  ];
  const finished = stats.completed + stats.failed + stats.cancelled;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('queue.title')}</h1>
          <p className="mt-2 max-w-[60ch] text-dust">{t('queue.subtitle')}</p>
        </div>
        {finished > 0 && (
          <button
            type="button"
            onClick={() => void clearFinished()}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-dust ring-1 ring-rule transition hover:bg-panel hover:text-paper"
          >
            <Trash2 className="size-4" />
            {t('queue.clearFinished', { count: finished })}
          </button>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t('queue.statActive'), stats.active, 'text-amber'],
          [t('queue.statQueued'), stats.queued, 'text-paper'],
          [t('queue.statDone'), stats.completed, 'text-paper'],
          [t('queue.statProblem'), stats.failed + stats.cancelled, stats.failed ? 'text-danger' : 'text-paper'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl bg-panel px-4 py-3 ring-1 ring-rule">
            <dt className="text-sm text-fade">{label}</dt>
            <dd className={clsx('font-display text-3xl font-extrabold tabular-nums', color as string)}>{value}</dd>
          </div>
        ))}
      </dl>

      <div role="tablist" aria-label={t('queue.title')} className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            role="tab"
            type="button"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition',
              filter === f.key ? 'bg-paper text-night' : 'bg-panel text-dust ring-1 ring-rule hover:text-paper',
            )}
          >
            {f.label}
            <span className={clsx('rounded-full px-1.5 text-xs tabular-nums', filter === f.key ? 'bg-night/10' : 'bg-raised')}>
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-rule px-6 py-16 text-center">
          <Inbox className="size-10 text-fade" strokeWidth={1.25} />
          <div>
            <p className="font-display text-xl font-bold">{t('queue.emptyTitle')}</p>
            <p className="mt-1 text-dust">{t('queue.emptyBody')}</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('search')}
            className="rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-night transition hover:bg-amber-hi"
          >
            {t('nav.search')}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} className="overflow-hidden rounded-2xl bg-panel/50 ring-1 ring-rule">
              {g.batch ? (
                <BatchHeader batch={g.batch} />
              ) : (
                <div className="flex items-center gap-3 border-b border-rule px-3 py-3">
                  <span className="font-display text-lg font-bold">{t('queue.singles')}</span>
                  <span className="text-xs text-fade">{t('queue.trackCount', { count: g.jobs.length })}</span>
                </div>
              )}
              <ol className="divide-y divide-rule/60">
                {g.jobs.map((job) => (
                  <li key={job.id}>
                    <JobRow job={job} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
