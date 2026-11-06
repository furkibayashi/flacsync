import clsx from 'clsx';
import { Disc3 } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { formatDuration, PLATFORM_DOT, PLATFORM_LABEL } from '../lib/format';
import type { SearchResult } from '../types/api';

interface Props {
  results: SearchResult[];
  selectedId: string | null;
  onSelect: (result: SearchResult) => void;
}

/** Aramanın diğer sonuçları: seçili olanın yerine geçmek için tıklanır. */
export function ResultsList({ results, selectedId, onSelect }: Props) {
  const { t } = useI18n();

  return (
    <section aria-labelledby="other-results" className="space-y-3">
      <h2 id="other-results" className="font-display text-xl font-bold tracking-tight">
        {t('results.more')}
      </h2>
      <ul className="divide-y divide-rule border-y border-rule">
        {results.map((r) => {
          const selected = r.id === selectedId;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                aria-current={selected ? 'true' : undefined}
                aria-label={t('results.choose', { title: r.title, artist: r.artist })}
                className={clsx(
                  'group grid w-full grid-cols-[44px_1fr_auto] items-center gap-4 py-3 pr-2 pl-3 text-left transition sm:grid-cols-[44px_1fr_auto_auto]',
                  selected ? 'bg-panel shadow-[inset_3px_0_0_var(--color-amber)]' : 'hover:bg-panel/60',
                )}
              >
                <span className="size-11 overflow-hidden rounded bg-raised">
                  {r.coverUrl ? (
                    <img src={r.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <Disc3 className="m-2.5 size-6 text-fade" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={clsx('block truncate font-medium', selected ? 'text-amber' : 'text-paper')}>
                    {r.title}
                  </span>
                  <span className="block truncate text-sm text-dust">
                    {r.artist}
                    {r.album && <span className="text-fade">{`, ${r.album}`}</span>}
                  </span>
                </span>
                <span className="hidden items-center gap-1 sm:flex" aria-label={r.sources.map((s) => PLATFORM_LABEL[s]).join(', ')}>
                  {r.sources.map((s) => (
                    <span key={s} title={PLATFORM_LABEL[s]} className={clsx('size-2 rounded-full', PLATFORM_DOT[s])} />
                  ))}
                </span>
                <span className="text-right text-sm text-dust tabular-nums">
                  {r.releaseYear && <span className="mr-3 hidden text-fade md:inline">{r.releaseYear}</span>}
                  {formatDuration(r.duration)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
