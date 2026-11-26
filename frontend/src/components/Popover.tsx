import clsx from 'clsx';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

/**
 * Düğmeye bağlı küçük açılır menü. Dışarı tıklayınca / Esc ile kapanır.
 * `children` bir fonksiyonsa `close` alır (seçim yapılınca menüyü kapatmak için).
 *
 * Klavye: açılınca ilk öğeye odaklanır, ↑ ↓ Home End ile öğeler arasında gezilir, Esc yalnızca bu
 * menüyü kapatır (arkadaki "Şimdi çalıyor" ya da pencere kapanmaz), kapanınca odak düğmeye döner.
 */
export function Popover({
  trigger,
  children,
  align = 'right',
  side = 'top',
  className,
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  side?: 'top' | 'bottom';
  className?: string;
  /** Ekran okuyucu için menünün adı */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /** Menüyü açan öğe: kapanınca odak ona döner */
  const opener = useRef<HTMLElement | null>(null);

  const close = () => {
    setOpen(false);
    const el = opener.current;
    // Odak menünün içindeyse (ya da menüyle birlikte kaybolduysa) açan düğmeye döner
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (el && el.isConnected && (!active || active === document.body || ref.current?.contains(active))) el.focus();
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Yakalama aşamasında: önce en üstteki katman (bu menü) kapanır, olay başkalarına "işlendi" olarak gider
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    // Açılınca ilk menü öğesine (ya da ilk alana) odaklan
    const id = requestAnimationFrame(() => {
      const root = panel.current;
      if (!root || root.contains(document.activeElement)) return;
      root.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), input, button:not(:disabled)')?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
    // close kararlıdır (yalnızca ref'ler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  return (
    <div ref={ref} className="relative">
      {trigger({
        open,
        toggle: () => {
          if (!open) opener.current = document.activeElement as HTMLElement | null;
          if (open) close();
          else setOpen(true);
        },
      })}
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKey}
          className={clsx(
            'absolute z-50 min-w-56 overflow-hidden rounded-2xl bg-panel py-1.5 shadow-2xl shadow-black/50 ring-1 ring-rule',
            side === 'top' ? 'bottom-[calc(100%+10px)]' : 'top-[calc(100%+8px)]',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  disabled,
  icon,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition hover:bg-raised focus-visible:bg-raised focus-visible:outline-none disabled:opacity-40',
        danger ? 'text-danger' : active ? 'font-semibold text-amber' : 'text-paper',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
