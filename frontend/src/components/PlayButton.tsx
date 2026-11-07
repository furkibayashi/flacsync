import clsx from 'clsx';
import { AudioLines, Pause, Play } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

/** Liste satırlarındaki küçük çal / duraklat düğmesi. Çalarken ses dalgası gösterir. */
export function RowPlayButton({
  active,
  playing,
  onClick,
  disabled,
  className,
  size = 'md',
}: {
  active: boolean;
  playing: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const { t } = useI18n();
  const label = disabled ? t('player.noPreview') : playing ? t('player.pause') : t('player.play');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={clsx(
        'group/play grid shrink-0 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30',
        size === 'lg' ? 'size-12' : 'size-9',
        active ? 'bg-amber text-on-accent' : 'bg-raised text-paper ring-1 ring-rule hover:bg-paper hover:text-night',
        className,
      )}
    >
      {playing ? (
        <>
          <AudioLines className="size-4 group-hover/play:hidden" />
          <Pause className="hidden size-4 fill-current group-hover/play:block" />
        </>
      ) : (
        <Play className="ml-0.5 size-4 fill-current" />
      )}
    </button>
  );
}
