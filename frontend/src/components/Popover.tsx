import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Düğmeye bağlı küçük açılır menü. Dışarı tıklayınca / Esc ile kapanır.
 * `children` bir fonksiyonsa `close` alır (seçim yapılınca menüyü kapatmak için).
 */
export function Popover({
  trigger,
  children,
  align = 'right',
  side = 'top',
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  side?: 'top' | 'bottom';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
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
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition hover:bg-raised disabled:opacity-40',
        active ? 'font-semibold text-amber' : 'text-paper',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
