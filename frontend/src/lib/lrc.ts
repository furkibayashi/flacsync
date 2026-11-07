export interface LrcLine {
  timeMs: number;
  text: string;
}

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** LRC → zamana göre sıralı satırlar (sunucudaki backend/src/services/lyrics/lrc.ts ile aynı kurallar) */
export function parseLrc(lrc: string): LrcLine[] {
  const offset = Number(/\[offset:\s*([+-]?\d+)\]/i.exec(lrc)?.[1] ?? 0);
  const lines: LrcLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;
    const text = raw.replace(TIMESTAMP, '').trim();
    for (const m of stamps) {
      const fraction = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
      lines.push({ timeMs: Math.max(0, Number(m[1]) * 60_000 + Number(m[2]) * 1000 + fraction - offset), text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Şu an söylenen satırın sırası (henüz başlamadıysa -1) */
export function activeLine(lines: LrcLine[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.timeMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
