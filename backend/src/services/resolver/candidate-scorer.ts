import { scoreTrackMatch, splitArtistTitle, titleSimilarity } from '../matcher/similarity.js';
import type { TrackMetadata } from '../metadata/types.js';
import type { MatchStrategy } from './types.js';

/**
 * Hedef başlıkta yoksa adayı doğrudan eleyen anahtar kelimeler.
 * Parantez dışındaki varyantları da yakalar ("Song Karaoke Version", "Song sped up").
 */
const UNWANTED_VARIANTS =
  /\b(?:cover|karaoke|instrumental|live|remix|sped\s?up|slowed|nightcore|8d|reverb|acoustic|tribute|reaction|bass\s?boosted|mashup|piano\s(?:version|cover)|minus)\b/i;

/** Metindeki ilk sürüm anahtar kelimesi (live, remix, cover…); yoksa null. */
export function variantKeyword(text: string): string | null {
  return UNWANTED_VARIANTS.exec(text)?.[0]?.toLowerCase() ?? null;
}

export function hasUnwantedVariant(targetTitle: string, candidateText: string): boolean {
  const unwanted = UNWANTED_VARIANTS.exec(candidateText);
  if (!unwanted) return false;
  return !new RegExp(`\\b${unwanted[0]}\\b`, 'i').test(targetTitle);
}

/**
 * Arama sonucundaki (yalnızca başlığı bilinen) adayın ön skoru.
 * Pahalı tam-bilgi sorgusundan önce adayları elemek için kullanılır.
 */
export function preScoreEntry(target: TrackMetadata, entryTitle: string): number {
  if (hasUnwantedVariant(target.title, entryTitle)) return 0;
  const split = splitArtistTitle(entryTitle);
  return Math.max(
    titleSimilarity(target.title, entryTitle),
    split ? titleSimilarity(target.title, split.title) : 0,
  );
}

export interface CandidateScore {
  /** 0-1: eşik kontrolünde kullanılan saf benzerlik skoru */
  score: number;
  /** Sıralama skoru: resmî kaynak ve ISRC bonusları dahil */
  rank: number;
  durationDiff: number | null;
}

/**
 * Tam bilgisi alınmış adayı hedef metadata ile karşılaştırır.
 * `candidate` youTubeInfoToMetadata çıktısıdır; `rawTitle` video başlığının kendisidir.
 */
export function scoreCandidate(
  target: TrackMetadata,
  candidate: TrackMetadata,
  context: {
    rawTitle: string;
    channel: string | null;
    hasOfficialTrackMetadata: boolean;
    strategy: MatchStrategy;
    durationToleranceSec: number;
  },
): CandidateScore {
  const durationDiff =
    target.duration && candidate.duration ? Math.abs(target.duration - candidate.duration) : null;

  if (hasUnwantedVariant(target.title, `${context.rawTitle} ${candidate.title}`)) {
    return { score: 0, rank: 0, durationDiff };
  }

  const score = scoreTrackMatch(
    { title: target.title, artist: target.artist, duration: target.duration },
    { title: candidate.title, artist: candidate.artist, duration: candidate.duration },
    { durationToleranceSec: context.durationToleranceSec },
  );
  if (score === 0) return { score: 0, rank: 0, durationDiff };

  let rank = score;
  // YouTube Music'in resmî "track/artist/album" alanları = plak şirketinin yüklediği ses
  if (context.hasOfficialTrackMetadata) rank += 0.04;
  if (context.channel && /\s-\sTopic$/i.test(context.channel)) rank += 0.03;
  if (context.strategy === 'isrc') rank += 0.03;
  // Albüm adı da tutuyorsa aynı yayın olma ihtimali yüksek
  if (target.album && candidate.album && titleSimilarity(target.album, candidate.album) >= 0.9) rank += 0.02;

  return { score, rank, durationDiff };
}
