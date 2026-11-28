import clsx from 'clsx';
import { Heart } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { setLiked, useIsLiked } from '../state/likes';

/**
 * Sevilen şarkı düğmesi (kalp). Yalnızca kütüphanedeki şarkılarda gösterilir;
 * libraryId yoksa (önizleme) hiçbir şey çizilmez.
 */
export function LikeButton({
  libraryId,
  size = 'md',
  className,
}: {
  libraryId: string | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { t } = useI18n();
  const liked = useIsLiked(libraryId);
  if (!libraryId) return null;
  const label = liked ? t('player.unlike') : t('player.like');
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void setLiked(libraryId, !liked, t('player.likeFailed'));
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-pressed={liked}
      aria-label={label}
      title={label}
      className={clsx(
        'grid shrink-0 place-items-center rounded-full transition hover:bg-raised active:scale-90',
        size === 'sm' ? 'size-8' : size === 'lg' ? 'size-11' : 'size-9',
        liked ? 'text-danger' : 'text-dust hover:text-paper',
        className,
      )}
    >
      <Heart
        className={clsx(size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-[18px]', liked && 'fill-current')}
        strokeWidth={liked ? 2 : 1.75}
      />
    </button>
  );
}
