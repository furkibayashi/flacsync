import clsx from 'clsx';
import { ArrowRight, Disc3, FolderOpen, Library, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { JobRow } from '../components/JobRow';
import { NewReleases } from '../components/NewReleases';
import { usePreferredFormat } from '../hooks/usePreferredFormat';
import { useI18n } from '../i18n/I18nProvider';
import { formatBytes, PLATFORM_LABEL } from '../lib/format';
import { formatNumber, formatSeconds, relativeTime } from '../lib/time';
import { api, isDesktopApp, revealSavedFile } from '../services/api';
import { isTerminal, useQueue } from '../state/QueueProvider';
import type { Route } from '../state/router';
import type { HistoryEntry, HistoryResponse } from '../types/api';

const PAGE = 24;

interface Props {
  onNavigate: (route: Route) => void;
  onSearch: (query: string) => void;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-panel px-5 py-4 ring-1 ring-rule">
      <p className="text-sm text-fade">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-dust">{hint}</p>}
    </div>
  );
}

function FormatSplit({ mp3, flac }: { mp3: number; flac: number }) {
  const { t } = useI18n();
  const total = mp3 + flac || 1;
  return (
    <div className="rounded-2xl bg-panel px-5 py-4 ring-1 ring-rule">
      <p className="text-sm text-fade">{t('home.formats')}</p>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-rule" aria-hidden>
        <span className="bg-amber" style={{ width: `${(mp3 / total) * 100}%` }} />
        <span className="bg-flac" style={{ width: `${(flac / total) * 100}%` }} />
      </div>
      <p className="mt-2 flex justify-between text-xs text-dust tabular-nums">
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-amber" />
          MP3 {mp3}
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-flac" />
          FLAC {flac}
        </span>
      </p>
    </div>
  );
}

function HistoryCard({ entry, onRemove, onRedownload }: { entry: HistoryEntry; onRemove: () => void; onRedownload: () => void }) {
  const { t, lang } = useI18n();
  return (
    <li className="group relative flex gap-3 rounded-xl p-2 transition hover:bg-panel">
      <span className="relative size-16 shrink-0 overflow-hidden rounded-md bg-raised shadow-md shadow-black/40">
        {entry.coverUrl ? (
          <img src={entry.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Disc3 className="m-4 size-8 text-fade" />
        )}
        <span
          className={clsx(
            'absolute bottom-1 left-1 rounded px-1 text-[10px] font-bold',
            entry.format === 'flac' ? 'bg-flac text-on-accent' : 'bg-amber text-on-accent',
          )}
        >
          {entry.format.toUpperCase()}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-paper" title={entry.title}>
          {entry.title}
        </p>
        <p className="truncate text-sm text-dust">{entry.artist}</p>
        <p className="mt-0.5 truncate text-xs text-fade">
          {[
            relativeTime(entry.completedAt, lang),
            formatBytes(entry.size),
            entry.durationMs ? formatSeconds(entry.durationMs, lang) : null,
            entry.collection ?? entry.album,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1 opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="flex gap-0.5">
          {isDesktopApp && (
            <button
              type="button"
              onClick={() => revealSavedFile(entry.id)}
              title={t('action.showInFolder')}
              className="grid size-7 place-items-center rounded-md text-fade transition hover:bg-raised hover:text-amber"
            >
              <FolderOpen className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onRedownload}
            title={t('home.redownload')}
            className="grid size-7 place-items-center rounded-md text-fade transition hover:bg-raised hover:text-paper"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title={t('home.removeFromHistory')}
            aria-label={t('home.removeAria', { title: entry.title })}
            className="grid size-7 place-items-center rounded-md text-fade transition hover:bg-raised hover:text-danger"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {entry.platform && <span className="hidden text-[11px] text-fade sm:inline">{PLATFORM_LABEL[entry.platform]}</span>}
      </div>
    </li>
  );
}

/** Ana sayfa: hızlı arama, istatistikler, şu an inenler ve kalıcı indirme geçmişi. */
export function HomePage({ onNavigate, onSearch }: Props) {
  const { t, lang } = useI18n();
  const { jobs, order, stats: queueStats, enqueue } = useQueue();
  const [format] = usePreferredFormat();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState('');

  const load = useCallback(async (n: number) => {
    try {
      setHistory(await api.history(n));
    } catch {
      // geçmiş okunamazsa bölüm boş kalır
    }
  }, []);

  // Her tamamlanan indirmede geçmişi tazele
  useEffect(() => {
    void load(limit);
  }, [load, limit, queueStats.completed]);

  const active = order.map((id) => jobs[id]!).filter((j) => j && !isTerminal(j));
  const s = history?.stats;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };

  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <h1 className="max-w-[18ch] font-display text-5xl leading-[0.98] font-extrabold tracking-[-0.035em] text-balance sm:text-6xl">
            {s && s.total > 0 ? t('home.titleBack') : t('home.titleNew')}
          </h1>
          <p className="mt-3 max-w-[58ch] text-lg text-dust">{t('home.subtitle')}</p>
        </div>
        <form onSubmit={submit} role="search" className="flex max-w-2xl items-center gap-2 rounded-2xl bg-panel py-2 pr-2 pl-5 ring-1 ring-rule focus-within:ring-2 focus-within:ring-amber">
          <Search className="size-5 shrink-0 text-fade" aria-hidden />
          <label htmlFor="home-query" className="sr-only">
            {t('input.label')}
          </label>
          <input
            id="home-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('input.placeholder')}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-lg text-paper placeholder:text-fade focus:outline-none"
          />
          <button type="submit" disabled={!query.trim()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-paper px-5 font-display font-bold text-night transition hover:bg-paper/85 disabled:opacity-40">
            {t('action.search')}
            <ArrowRight className="size-4" />
          </button>
        </form>
      </header>

      <section aria-label={t('home.statsTitle')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('home.statTotal')} value={formatNumber(s?.total ?? 0, lang)} hint={t('home.statTotalHint')} />
        <StatCard label={t('home.statWeek')} value={formatNumber(s?.last7Days ?? 0, lang)} hint={t('home.statWeekHint')} />
        <StatCard label={t('home.statSize')} value={formatBytes(s?.totalBytes ?? 0).replace('–', '0 B')} hint={t('home.statSizeHint')} />
        <FormatSplit mp3={s?.formats.mp3 ?? 0} flac={s?.formats.flac ?? 0} />
      </section>

      {active.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              {t('home.activeTitle')}
              <span className="ml-2 align-middle text-sm font-semibold text-amber tabular-nums">{active.length}</span>
            </h2>
            <button type="button" onClick={() => onNavigate('queue')} className="inline-flex items-center gap-1 text-sm font-semibold text-dust hover:text-paper">
              {t('home.openQueue')}
              <ArrowRight className="size-4" />
            </button>
          </div>
          <div className="rounded-2xl bg-panel/50 p-1 ring-1 ring-rule">
            {active.slice(0, 4).map((job) => (
              <JobRow key={job.id} job={job} compact />
            ))}
            {active.length > 4 && (
              <p className="px-3 py-2 text-sm text-fade">{t('home.moreInQueue', { count: active.length - 4 })}</p>
            )}
          </div>
        </section>
      )}

      <NewReleases onOpen={onSearch} onDiscover={() => onNavigate('discover')} />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl font-bold tracking-tight">{t('home.recentTitle')}</h2>
          {history && history.total > 0 && <span className="text-sm text-fade">{t('home.recentCount', { count: history.total })}</span>}
        </div>

        {!history || history.items.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-rule px-6 py-10 sm:flex-row sm:items-center">
            <Library className="size-10 shrink-0 text-fade" strokeWidth={1.25} />
            <div className="flex-1">
              <p className="font-display text-xl font-bold">{t('home.emptyTitle')}</p>
              <p className="mt-1 text-dust">{t('home.emptyBody')}</p>
            </div>
            <button type="button" onClick={() => onNavigate('search')} className="rounded-xl bg-amber px-5 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi">
              {t('home.emptyCta')}
            </button>
          </div>
        ) : (
          <>
            <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
              {history.items.map((entry) => (
                <HistoryCard
                  key={entry.id}
                  entry={entry}
                  onRedownload={() => void enqueue(entry.sourceUrl, format)}
                  onRemove={() => void api.removeHistory(entry.id).then(() => load(limit))}
                />
              ))}
            </ul>
            {history.total > history.items.length && (
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE)}
                className="mx-auto block rounded-xl px-5 py-2.5 text-sm font-semibold text-dust ring-1 ring-rule transition hover:bg-panel hover:text-paper"
              >
                {t('results.showMore')}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
