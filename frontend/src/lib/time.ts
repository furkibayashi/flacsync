import { LANG_LOCALE as LOCALE, type Lang } from '../i18n/translations';

/** "3 dakika önce" / "3 minutes ago" */
export function relativeTime(iso: string, lang: Lang, now = Date.now()): string {
  const diffSec = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(diffSec / 86_400), 'day');
  return new Date(iso).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 6778 → "6,8 sn" / "6.8 sec" (dilin kendi birim kısaltmasıyla) */
export function formatSeconds(ms: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: ms < 10_000 ? 1 : 0,
  }).format(ms / 1000);
}

export function formatNumber(n: number, lang: Lang): string {
  return n.toLocaleString(LOCALE[lang]);
}
