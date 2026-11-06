import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { codecLabel } from '../lib/format';
import type { UiError } from '../services/api';
import type { ResolvedSource } from '../types/api';

export type SourceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: ResolvedSource }
  | { status: 'error'; error: UiError };

/** Ses kaynağı eşleşmesinin durumu: aranıyor / bulundu / bulunamadı. */
export function SourceLine({ source }: { source: SourceState }) {
  const { t, tError } = useI18n();

  if (source.status === 'idle') return null;

  if (source.status === 'loading') {
    return (
      <p className="flex items-center gap-2.5 text-[15px] text-dust" aria-live="polite">
        <Loader2 className="size-4 animate-spin text-amber" />
        {t('source.searching')}…
      </p>
    );
  }

  if (source.status === 'error') {
    return (
      <p className="flex items-start gap-2.5 text-[15px] text-danger" role="alert">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        {tError(source.error.code, source.error.message)}
      </p>
    );
  }

  const { match, format, pageUrl } = source.data;
  const via = t(`source.via.${match.strategy}` as const);

  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[15px]">
        <span className="font-semibold text-paper">{t('source.found')}</span>
        <span className="text-amber">{t('source.match', { score: Math.round(match.score * 100) })}</span>
        <span className="text-dust">{codecLabel(format)}</span>
        <a
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-fade underline-offset-4 transition hover:text-paper hover:underline"
        >
          {t('source.open')}
          <ExternalLink className="size-3.5" />
        </a>
      </p>
      <p className="max-w-[62ch] text-sm leading-relaxed text-fade">
        {via}
        {match.durationDiff !== null && `, ${t('source.durationDiff', { sec: match.durationDiff })}`}.{' '}
        {!format.isLossless && t('source.lossy', { codec: codecLabel(format) })}
      </p>
    </div>
  );
}
