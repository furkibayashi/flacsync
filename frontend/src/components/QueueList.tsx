import clsx from 'clsx';
import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { usePlayer } from '../state/PlayerProvider';

/**
 * Çalma sırası: tıklayınca o şarkıya geçer, tutup sürükleyerek sıralanır, ✕ ile çıkarılır.
 * `tone="dark"`: Şimdi çalıyor ekranının koyu, saydam zemini için.
 */
export function QueueList({ tone = 'panel', className }: { tone?: 'panel' | 'dark'; className?: string }) {
  const { t } = useI18n();
  const { queue, index, jumpTo, removeAt, move, clearUpcoming } = usePlayer();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const upcoming = Math.max(0, queue.length - index - 1);
  const dark = tone === 'dark';

  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      {upcoming > 0 && (
        <div className="flex items-center justify-between px-4 py-1.5 text-xs">
          <span className={dark ? 'text-paper/60' : 'text-dust'}>{t('player.dragHint')}</span>
          <button type="button" onClick={clearUpcoming} className="font-semibold text-amber hover:text-amber-hi">
            {t('player.clearUpcoming', { count: upcoming })}
          </button>
        </div>
      )}
      <ol ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto py-1">
        {queue.map((track, i) => (
          <li
            key={`${track.id}-${i}`}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              // Gösterge "hedefin üstüne" der: aşağı taşırken bir önceki yere düşer
              if (dragFrom !== null && dragFrom !== i) move(dragFrom, dragFrom < i ? i - 1 : i);
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            aria-current={i === index}
            className={clsx(
              'group/q flex items-center gap-2 px-2 transition',
              dark ? 'hover:bg-white/5' : 'hover:bg-raised',
              i === index && (dark ? 'bg-white/10' : 'bg-raised/70'),
              dragFrom === i && 'opacity-40',
              dragOver === i && dragFrom !== i && 'shadow-[inset_0_2px_0_var(--color-amber)]',
            )}
          >
            <span
              aria-hidden
              className={clsx('cursor-grab opacity-0 transition group-hover/q:opacity-100', dark ? 'text-paper/40' : 'text-fade')}
            >
              <GripVertical className="size-4" />
            </span>
            <button
              type="button"
              onClick={() => jumpTo(i)}
              onKeyDown={(e) => {
                // Alt + ↑ / ↓: klavyeyle sıralama (sürükle-bırakın karşılığı)
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
                if (to < 0 || to >= queue.length) return;
                move(i, to);
                requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>('[data-queue-item]')[to]?.focus());
              }}
              data-queue-item
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
            >
              <span className={clsx('w-5 shrink-0 text-right text-xs tabular-nums', dark ? 'text-paper/50' : 'text-fade')}>{i + 1}</span>
              {track.coverUrl && (
                <span className="size-9 shrink-0 overflow-hidden rounded bg-raised">
                  <img src={track.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-sm', i === index ? 'font-semibold text-amber' : 'text-paper')}>{track.title}</span>
                <span className={clsx('block truncate text-xs', dark ? 'text-paper/60' : 'text-dust')}>
                  {track.kind === 'preview' ? `${t('player.preview')} · ` : ''}
                  {track.artist}
                </span>
              </span>
            </button>
            <span className="flex shrink-0 flex-col opacity-0 transition group-hover/q:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                title={t('player.moveUp')}
                aria-label={`${t('player.moveUp')}: ${track.title}`}
                className={clsx('grid h-4 w-7 place-items-center rounded disabled:opacity-30', dark ? 'text-paper/60 hover:text-paper' : 'text-dust hover:text-paper')}
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                disabled={i === queue.length - 1}
                onClick={() => move(i, i + 1)}
                title={t('player.moveDown')}
                aria-label={`${t('player.moveDown')}: ${track.title}`}
                className={clsx('grid h-4 w-7 place-items-center rounded disabled:opacity-30', dark ? 'text-paper/60 hover:text-paper' : 'text-dust hover:text-paper')}
              >
                <ChevronDown className="size-4" />
              </button>
            </span>
            <button
              type="button"
              onClick={() => removeAt(i)}
              title={t('player.removeFromQueue')}
              aria-label={`${t('player.removeFromQueue')}: ${track.title}`}
              className={clsx(
                'grid size-8 shrink-0 place-items-center rounded-full opacity-0 transition group-hover/q:opacity-100 focus-visible:opacity-100 hover:text-danger [@media(hover:none)]:opacity-100',
                dark ? 'text-paper/50' : 'text-fade',
              )}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
