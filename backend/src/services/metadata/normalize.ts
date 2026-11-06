import type { TrackMetadata } from './types.js';

/** Albüm / çalma listesinden alınacak en fazla parça sayısı */
export const MAX_COLLECTION_TRACKS = 300;

const ISRC_PATTERN =/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

export function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/** "2024-05-10", "2024", "20240510", 2024 → "2024" */
export function toYear(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const match = /^(\d{4})/.exec(String(value).trim());
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  return year >= 1860 && year <= new Date().getFullYear() + 1 ? match[1] : null;
}

export function normalizeIsrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const isrc = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return ISRC_PATTERN.test(isrc) ? isrc : null;
}

export function msToSeconds(ms: number | null | undefined): number | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null;
}

export function joinArtists(names: ReadonlyArray<string | null | undefined>): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const clean = cleanString(name);
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      result.push(clean);
    }
  }
  return result.join(', ');
}

/**
 * `primary` içindeki boş alanları `secondary` ile doldurur.
 * Başlık ve sanatçı her zaman kaynak platformdan gelir.
 */
export function mergeMetadata(
  primary: TrackMetadata,
  secondary: TrackMetadata,
  options: { preferSecondaryCover?: boolean } = {},
): TrackMetadata {
  return {
    title: primary.title,
    artist: primary.artist,
    album: primary.album ?? secondary.album,
    releaseDate: primary.releaseDate ?? secondary.releaseDate,
    coverUrl: options.preferSecondaryCover
      ? secondary.coverUrl ?? primary.coverUrl
      : primary.coverUrl ?? secondary.coverUrl,
    isrc: primary.isrc ?? secondary.isrc,
    duration: primary.duration ?? secondary.duration,
  };
}

/** Çıktıyı standart formata zorlar (trim, yıl, ISRC formatı, tam sayı süre). */
export function finalizeMetadata(m: TrackMetadata): TrackMetadata {
  return {
    title: cleanString(m.title) ?? 'Unknown Title',
    artist: cleanString(m.artist) ?? 'Unknown Artist',
    album: cleanString(m.album),
    releaseDate: toYear(m.releaseDate),
    coverUrl: cleanString(m.coverUrl),
    isrc: normalizeIsrc(m.isrc),
    duration: typeof m.duration === 'number' && m.duration > 0 ? Math.round(m.duration) : null,
  };
}

export function hasMissingFields(m: TrackMetadata): boolean {
  return !m.isrc || !m.album || !m.releaseDate || !m.coverUrl || !m.duration;
}
