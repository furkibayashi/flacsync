import clsx from 'clsx';
import { LibraryBig } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

/** "Kütüphanende var" rozeti: bu şarkı zaten indirilmiş, tam uzunlukta çalınabilir */
export function InLibraryBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      title={t('library.inLibraryHint')}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/15 font-semibold text-ok ring-1 ring-ok/30',
        compact ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]',
        className,
      )}
    >
      <LibraryBig className={compact ? 'size-3' : 'size-3.5'} />
      {!compact && t('library.inLibrary')}
    </span>
  );
}
