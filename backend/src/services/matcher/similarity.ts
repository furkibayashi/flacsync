import { stringSimilarity } from 'string-similarity-js';

/**
 * Metadata zenginleştirme ve indirme kaynağı eşleştirmede ortak kullanılan
 * başlık / sanatçı / süre skorlaması.
 */

const NOISE_PATTERNS: RegExp[] = [
  // (feat. X) / [ft. X] / (with X)
  /[([](?:feat|ft|with)\.?\s[^)\]]*[)\]]/gi,
  // " - Remastered 2009"
  /\s-\s(?:\d{4}\s)?remaster(?:ed)?(?:\s\d{4})?.*$/gi,
  // (Official Video), [Official Music Video], (4K Remaster), (Lyrics), (HD) ...
  // "(Live)" / "(Remix)" gibi farklı versiyonları belirten ekler korunur.
  /[([][^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|remaster(?:ed)?|hd|hq|4k|mv)\b[^)\]]*[)\]]/gi,
  // (Original Mix), (Album Version), " - Original Version" → aynı kayıt
  /[([](?:original|album)\s(?:mix|version)[)\]]/gi,
  /\s-\s(?:original|album)\s(?:mix|version)$/gi,
];

/**
 * Gürültü atıldıktan sonra kalan versiyon ekleri: "(Live)", "(Remix)",
 * "(Pianoforte)", " - Radio Edit" ... Farklı ekler = farklı kayıt.
 */
export function versionTag(value: string): string {
  const stripped = stripTitleNoise(value);
  const tags = [
    ...[...stripped.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1] ?? ''),
    /\s[-–—]\s(.+)$/.exec(stripped)?.[1] ?? '',
  ];
  return normalizeBasic(tags.join(' '));
}

function baseTitle(value: string): string {
  return stripTitleNoise(value)
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s[-–—]\s.+$/, ' ');
}

/** Başlıktaki "(Official Video)", "(feat. X)" gibi gürültüyü atar; büyük/küçük harfi korur. */
export function stripTitleNoise(value: string): string {
  let s = value;
  for (const pattern of NOISE_PATTERNS) s = s.replace(pattern, ' ');
  return s.replace(/\s+/g, ' ').trim() || value.trim();
}

export function normalizeText(value: string): string {
  return normalizeBasic(stripTitleNoise(value));
}

function normalizeBasic(value: string): string {
  return value
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return stringSimilarity(na, nb);
}

/**
 * Şarkı başlığı benzerliği: ana başlık + versiyon eki ayrı değerlendirilir.
 * "Song" ile "Song (Live)" / "Song (Remix)" eşleşmez.
 */
export function titleSimilarity(a: string, b: string): number {
  const base = textSimilarity(baseTitle(a), baseTitle(b));
  const va = versionTag(a);
  const vb = versionTag(b);
  if (va === vb) return base;
  // İki tarafta da ek var ve birbirine çok benziyorsa ("Live" vs "Live at X") hafif ceza
  if (va && vb && stringSimilarity(va, vb) >= 0.8) return base * 0.9;
  return base * 0.5;
}

/** "Sanatçı - Şarkı (Official Video)" biçimindeki video başlıklarını ayırır. */
export function splitArtistTitle(value: string): { artist: string; title: string } | null {
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(value);
  return match?.[1] && match[2] ? { artist: match[1].trim(), title: match[2].trim() } : null;
}

export function splitArtists(artist: string): string[] {
  return artist
    .split(/\s*(?:,|;|&|\/|\bfeat\.?|\bft\.?|\bx\b|\bvs\.?)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Sanatçı listelerinden en iyi eşleşen ikilinin benzerliği. */
export function artistSimilarity(a: string, b: string): number {
  const listA = splitArtists(a);
  const listB = splitArtists(b);
  let best = textSimilarity(a, b);
  for (const x of listA) for (const y of listB) best = Math.max(best, textSimilarity(x, y));
  return best;
}

export interface MatchCandidate {
  title: string;
  artist: string;
  /** saniye */
  duration: number | null;
}

/**
 * 0-1 arası skor. Süre farkı toleransı aşarsa ya da başlık/sanatçı
 * çok uzaksa 0 döner.
 */
export function scoreTrackMatch(
  target: MatchCandidate,
  candidate: MatchCandidate,
  options: { durationToleranceSec: number },
): number {
  const titleScore = titleSimilarity(target.title, candidate.title);
  const artistScore = artistSimilarity(target.artist, candidate.artist);
  if (titleScore < 0.6 || artistScore < 0.5) return 0;

  let score = titleScore * 0.55 + artistScore * 0.35;

  if (target.duration && candidate.duration) {
    const tolerance = Math.max(options.durationToleranceSec, 1);
    const diff = Math.abs(target.duration - candidate.duration);
    if (diff > tolerance) return 0;
    score += 0.1 * (1 - diff / tolerance);
  } else {
    score += 0.05;
  }
  return Math.min(score, 1);
}
