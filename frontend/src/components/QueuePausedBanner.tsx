import { PauseCircle, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useQueue } from '../state/QueueProvider';
import type { TranslationKey } from '../i18n/translations';

/**
 * Art arda indirmeler başarısız olunca (bağlantı koptu, YouTube engeli…) kuyruk durur;
 * bu şerit nedenini söyler ve sürdürmeyi sağlar.
 */
export function QueuePausedBanner() {
  const { t } = useI18n();
  const { state, resume, stats } = useQueue();
  const [busy, setBusy] = useState(false);
  if (!state.paused) return null;

  const hintKey = `queue.pausedHint.${state.reason ?? 'default'}` as TranslationKey;
  const hint = t(hintKey) || t('queue.pausedHint.default');

  const go = async (retryFailed: boolean) => {
    setBusy(true);
    await resume(retryFailed);
    setBusy(false);
  };

  return (
    <div role="status" className="flex flex-col gap-4 rounded-2xl bg-amber/10 p-5 ring-1 ring-amber/40 sm:flex-row sm:items-center">
      <PauseCircle className="size-8 shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-bold text-paper">{t('queue.pausedTitle')}</p>
        <p className="mt-0.5 text-sm text-dust">{hint}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {stats.failed > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void go(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber px-4 py-2.5 font-display font-bold text-on-accent transition hover:bg-amber-hi disabled:opacity-50"
          >
            <RotateCcw className="size-4" />
            {t('queue.resumeRetry', { count: stats.failed })}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void go(false)}
          className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 font-semibold text-paper ring-1 ring-rule transition hover:ring-dust disabled:opacity-50"
        >
          <Play className="size-4 fill-current" />
          {t('queue.resume')}
        </button>
      </div>
    </div>
  );
}
