import { foldText } from './text';

/** Kütüphane radyosu için gereken alanlar (LibraryTrack'in alt kümesi) */
export interface RadioTrack {
  id: string;
  artist: string;
  genre: string | null;
  year: string | null;
  playCount: number;
}

/** "A, B & C feat. D" → ["a", "b", "c", "d"] (aksan / büyük-küçük harf duyarsız) */
export function splitArtistNames(artist: string): string[] {
  return artist
    .split(/\s*(?:,|&|;|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bvs\.?)\s*/i)
    .map((a) => foldText(a).trim())
    .filter(Boolean);
}

/**
 * Tohum şarkılara benzerlik puanı: aynı sanatçı en güçlü işaret, sonra tür, sonra yakın yıl.
 * Çok dinlenenler hafifçe öne çıkar.
 */
export function radioScore(track: RadioTrack, seeds: RadioTrack[]): number {
  const artists = new Set(splitArtistNames(track.artist));
  const genre = track.genre ? foldText(track.genre) : null;
  const year = Number.parseInt(track.year ?? '', 10);
  let best = 0;
  for (const seed of seeds) {
    let s = 0;
    if (splitArtistNames(seed.artist).some((a) => artists.has(a))) s += 3;
    if (genre && seed.genre && foldText(seed.genre) === genre) s += 2;
    const seedYear = Number.parseInt(seed.year ?? '', 10);
    if (Number.isFinite(year) && Number.isFinite(seedYear) && Math.abs(year - seedYear) <= 3) s += 1;
    best = Math.max(best, s);
  }
  return best + Math.min(1, Math.log10(1 + (track.playCount ?? 0)) / 2);
}

/**
 * Sıra bitince çalmaya devam etmek için kütüphaneden benzer şarkılar seçer.
 * - `exclude`: sırada olanlar / yakında çalınanlar (tekrar etmesin)
 * - Benzerlik puanına biraz rastgelelik eklenir (her seferinde aynı sıra çıkmasın)
 * - Aynı sanatçıdan en fazla 2 şarkı; hiç benzer yoksa kütüphaneden rastgele
 */
export function pickRadio<T extends RadioTrack>(
  seeds: RadioTrack[],
  library: T[],
  exclude: ReadonlySet<string>,
  count = 10,
  random: () => number = Math.random,
): T[] {
  const pool = library.filter((t) => !exclude.has(t.id));
  if (!pool.length || count <= 0) return [];
  const ranked = pool
    .map((t) => ({ t, score: radioScore(t, seeds) + random() * 1.5 }))
    .sort((a, b) => b.score - a.score);
  const perArtist = new Map<string, number>();
  const picked: T[] = [];
  for (const { t } of ranked) {
    const key = splitArtistNames(t.artist)[0] ?? '';
    const n = perArtist.get(key) ?? 0;
    if (n >= 2) continue;
    perArtist.set(key, n + 1);
    picked.push(t);
    if (picked.length >= count) break;
  }
  return picked;
}
