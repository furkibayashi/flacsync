import clsx from 'clsx';
import { Disc3, House, ListOrdered, Search, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { isTerminal, useQueue } from '../state/QueueProvider';
import type { Route } from '../state/router';
import { LanguageSwitch } from './LanguageSwitch';

const NAV: Array<{ route: Route; icon: LucideIcon; label: 'nav.home' | 'nav.search' | 'nav.queue' }> = [
  { route: 'home', icon: House, label: 'nav.home' },
  { route: 'search', icon: Search, label: 'nav.search' },
  { route: 'queue', icon: ListOrdered, label: 'nav.queue' },
];

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#2a2638" />
        <circle cx="16" cy="16" r="11" fill="none" stroke="#383349" strokeWidth="1" />
        <circle cx="16" cy="16" r="7.5" fill="none" stroke="#383349" strokeWidth="1" />
        <circle cx="16" cy="16" r="4.5" fill="#f2b544" />
        <circle cx="16" cy="16" r="1.2" fill="#17151f" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight">FlacSync</span>
    </span>
  );
}

/** Menünün altında: şu an inen parça (kapak + ilerleme) ve sıradaki sayısı. */
function NowDownloading({ onOpenQueue }: { onOpenQueue: () => void }) {
  const { t } = useI18n();
  const { jobs, order, stats } = useQueue();
  const current = order.map((id) => jobs[id]).find((j) => j && !isTerminal(j) && j.status !== 'queued');
  if (!current) return null;
  const meta = current.metadata;

  return (
    <button
      type="button"
      onClick={onOpenQueue}
      className="block w-full rounded-xl bg-raised/60 p-3 text-left ring-1 ring-rule transition hover:ring-amber/50"
    >
      <p className="mb-2 flex items-center justify-between text-xs font-semibold text-amber">
        <span>{t('nav.nowDownloading')}</span>
        {stats.queued > 0 && <span className="text-fade">{t('nav.queuedMore', { count: stats.queued })}</span>}
      </p>
      <span className="flex items-center gap-3">
        <span className="relative size-10 shrink-0 overflow-hidden rounded bg-night">
          {meta?.coverUrl ? (
            <img src={meta.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3 className="m-2 size-6 animate-spin text-fade [animation-duration:3s]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-paper">{meta?.title ?? t('status.resolving')}</span>
          <span className="block truncate text-xs text-dust">{meta?.artist ?? '…'}</span>
        </span>
      </span>
      <span className="mt-2.5 flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-rule">
          <span className="block h-full bg-amber transition-[width] duration-500" style={{ width: `${current.progress}%` }} />
        </span>
        <span className="text-[11px] text-dust tabular-nums">{current.progress}%</span>
      </span>
    </button>
  );
}

function Badge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-amber px-2 py-0.5 text-[11px] font-bold text-night tabular-nums">{count}</span>
  );
}

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  const { t } = useI18n();
  const { stats, connected } = useQueue();
  const pending = stats.active + stats.queued;

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-rule/70 bg-[#1b1925]/80 px-4 py-6 backdrop-blur md:flex">
      <div className="px-2">
        <Wordmark />
      </div>

      <nav aria-label={t('nav.label')}>
        <ul className="space-y-1">
          {NAV.map(({ route: r, icon: Icon, label }) => (
            <li key={r}>
              <button
                type="button"
                onClick={() => onNavigate(r)}
                aria-current={route === r ? 'page' : undefined}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition',
                  route === r ? 'bg-raised text-paper shadow-[inset_3px_0_0_var(--color-amber)]' : 'text-dust hover:bg-raised/50 hover:text-paper',
                )}
              >
                <Icon className={clsx('size-5', route === r && 'text-amber')} />
                {t(label)}
                {r === 'queue' && <Badge count={pending} />}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto space-y-4">
        <NowDownloading onOpenQueue={() => onNavigate('queue')} />
        <div className="flex items-center justify-between gap-2 px-1">
          <LanguageSwitch />
          <span
            className={clsx('size-2 rounded-full', connected ? 'bg-[#6fd39a]' : 'bg-danger')}
            title={connected ? t('nav.connected') : t('nav.disconnected')}
            aria-label={connected ? t('nav.connected') : t('nav.disconnected')}
          />
        </div>
      </div>
    </aside>
  );
}

/** Mobilde altta sabit sekme çubuğu. */
export function MobileNav({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  const { t } = useI18n();
  const { stats } = useQueue();
  const pending = stats.active + stats.queued;
  return (
    <nav aria-label={t('nav.label')} className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-[#1b1925]/95 backdrop-blur md:hidden">
      <ul className="grid grid-cols-3">
        {NAV.map(({ route: r, icon: Icon, label }) => (
          <li key={r}>
            <button
              type="button"
              onClick={() => onNavigate(r)}
              aria-current={route === r ? 'page' : undefined}
              className={clsx('relative flex w-full flex-col items-center gap-0.5 py-2.5 text-xs font-semibold', route === r ? 'text-amber' : 'text-dust')}
            >
              <Icon className="size-5" />
              {t(label)}
              {r === 'queue' && pending > 0 && (
                <span className="absolute top-1.5 left-[calc(50%+6px)] rounded-full bg-amber px-1.5 text-[10px] font-bold text-night tabular-nums">
                  {pending}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
