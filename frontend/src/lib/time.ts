import type { Lang } from '../i18n/translations';

const LOCALE: Record<Lang, string> = { tr: 'tr-TR', en: 'en-US' };

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

/** 6778 → "6,8 sn" / "6.8 s" */
export function formatSeconds(ms: number, lang: Lang): string {
  const value = (ms / 1000).toLocaleString(LOCALE[lang], { maximumFractionDigits: ms < 10_000 ? 1 : 0 });
  return lang === 'tr' ? `${value} sn` : `${value} s`;
}

export function formatNumber(n: number, lang: Lang): string {
  return n.toLocaleString(LOCALE[lang]);
}
