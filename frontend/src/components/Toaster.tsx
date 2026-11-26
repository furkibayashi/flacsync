import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useQueue } from '../state/QueueProvider';
import { dismissToast, useToasts } from '../state/toast';

/** Ekranın altında, oynatıcının üstünde kısa bildirimler. Ekran okuyuculara da duyurulur. */
export function Toaster() {
  const { t } = useI18n();
  const items = useToasts();
  const { current } = usePlayer();
  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions"
      className={clsx(
        'pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4',
        current ? 'bottom-44 md:bottom-28' : 'bottom-24 md:bottom-6',
      )}
    >
      {items.map((item) => {
        const Icon = item.kind === 'error' ? AlertCircle : item.kind === 'success' ? CheckCircle2 : Info;
        return (
          <div
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
            className="animate-rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-raised px-4 py-3 text-sm text-paper shadow-2xl shadow-black/40 ring-1 ring-rule-strong"
          >
            <Icon aria-hidden className={clsx('size-5 shrink-0', item.kind === 'error' ? 'text-danger' : item.kind === 'success' ? 'text-ok' : 'text-amber')} />
            <span className="min-w-0 flex-1">{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action!.run();
                  dismissToast(item.id);
                }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 font-bold text-amber transition hover:bg-night/60"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label={t('action.close')}
              className="grid size-8 shrink-0 place-items-center rounded-full text-dust transition hover:text-paper"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Sunucuyla bağlantı birkaç saniyeden uzun koparsa her ekran boyutunda görünen uyarı
 * (telefonda Wi-Fi ile bağlanınca en sık burada kopar).
 */
export function ConnectionBanner() {
  const { t } = useI18n();
  const { connected } = useQueue();
  const [show, setShow] = useState(false);
  const [everConnected, setEverConnected] = useState(false);

  useEffect(() => {
    if (connected) {
      setEverConnected(true);
      setShow(false);
      return;
    }
    // Açılışta ilk bağlantı biraz sürebilir; kısa kopmalar da gösterilmez
    const timer = setTimeout(() => setShow(true), everConnected ? 3000 : 8000);
    return () => clearTimeout(timer);
  }, [connected, everConnected]);

  if (!show) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-danger px-4 py-2 text-sm font-semibold text-on-danger">
      <WifiOff aria-hidden className="size-4" />
      {t('nav.disconnectedBanner')}
    </div>
  );
}
