import type { LrcLine } from './types.js';

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** [ar:..], [ti:..], [offset:..] gibi üst bilgi satırları */
const META_TAG = /^\[(ar|ti|al|au|by|re|ve|length|offset|#):[^\]]*\]\s*$/i;

/**
 * LRC metnini satırlara ayırır. Bir satırda birden fazla zaman damgası olabilir
 * ("[00:12.00][01:30.00] nakarat"); hepsi ayrı satır olarak döner, zamana göre sıralanır.
 */
export function parseLrc(lrc: string): LrcLine[] {
  const offset = Number(/\[offset:\s*([+-]?\d+)\]/i.exec(lrc)?.[1] ?? 0);
  const lines: LrcLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    if (META_TAG.test(raw.trim())) continue;
    const stamps = [...raw.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;
    const text = raw.replace(TIMESTAMP, '').trim();
    for (const m of stamps) {
      const fraction = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
      const timeMs = Number(m[1]) * 60_000 + Number(m[2]) * 1000 + fraction - offset;
      lines.push({ timeMs: Math.max(0, timeMs), text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** LRC'nin zaman damgalarını atıp düz söz üretir. */
export function lrcToPlain(lrc: string): string {
  return parseLrc(lrc)
    .map((l) => l.text)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Metin gerçekten zaman damgalı mı (en az birkaç satır)? */
export function isSyncedLrc(text: string | null | undefined): text is string {
  return Boolean(text) && parseLrc(text!).length >= 2;
}
