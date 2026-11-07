import clsx from 'clsx';
import type { LinkPlatform } from '../lib/format';
import { PLATFORM_DOT, PLATFORM_LABEL } from '../lib/format';

export function PlatformTag({ platform, className }: { platform: LinkPlatform; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-sm text-paper', className)}>
      <span className={clsx('size-2 rounded-full', PLATFORM_DOT[platform])} aria-hidden />
      {PLATFORM_LABEL[platform]}
    </span>
  );
}
