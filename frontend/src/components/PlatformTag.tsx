import clsx from 'clsx';
import { PLATFORM_DOT, PLATFORM_LABEL } from '../lib/format';
import type { Platform } from '../types/api';

export function PlatformTag({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-sm text-paper', className)}>
      <span className={clsx('size-2 rounded-full', PLATFORM_DOT[platform])} aria-hidden />
      {PLATFORM_LABEL[platform]}
    </span>
  );
}
