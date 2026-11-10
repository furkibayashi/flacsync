import { Loader2, Smartphone, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface LanStatus {
  enabled: boolean;
  url: string | null;
  qr: string | null;
  addresses: string[];
  error: string | null;
}

/**
 * Ayarlar → Telefona gönder (Wi-Fi): açılınca QR kod gösterilir. Telefonla okutunca FlacSync
 * telefonun tarayıcısında açılır; kütüphane dinlenir, şarkılar telefona indirilir.
 */
export function PhoneShare() {
  const { t } = useI18n();
  const lan = window.flacsync?.lan;
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void lan?.().then((s) => setStatus(s as LanStatus | null));
  }, [lan]);

  if (!lan) return null;

  const toggle = async () => {
    setBusy(true);
    setStatus((await lan(!status?.enabled)) as LanStatus | null);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold text-paper">
            <Wifi className="size-4 text-amber" />
            {t('phone.title')}
          </p>
          <p className="mt-0.5 text-sm text-dust">{t('phone.hint')}</p>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber px-4 py-2 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
          {status?.enabled ? t('phone.stop') : t('phone.start')}
        </button>
      </div>

      {status?.enabled && status.qr && status.url && (
        <div className="flex flex-col items-center gap-5 rounded-2xl bg-night/60 p-5 ring-1 ring-rule sm:flex-row sm:items-start">
          <img src={status.qr} alt={t('phone.qrAlt')} className="size-44 shrink-0 rounded-xl bg-white p-2" />
          <div className="min-w-0 space-y-2 text-sm text-dust">
            <p className="font-semibold text-paper">{t('phone.scan')}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t('phone.step1')}</li>
              <li>{t('phone.step2')}</li>
              <li>{t('phone.step3')}</li>
            </ol>
            <p className="pt-1 text-xs text-fade">{t('phone.firewall')}</p>
            <p className="truncate text-xs text-fade" title={status.url}>
              {status.url.replace(/\?key=.*/, '')}
            </p>
          </div>
        </div>
      )}
      {status?.error && <p className="text-sm text-danger">{status.error}</p>}
    </div>
  );
}
