import { createHash } from 'node:crypto';
import { stringSimilarity } from 'string-similarity-js';
import { artistSimilarity, normalizeText, scoreTrackMatch, textSimilarity, titleSimilarity } from '../matcher/similarity.js';
import type { Platform } from '../metadata/types.js';
import { hasUnwantedVariant, variantKeyword } from '../resolver/candidate-scorer.js';
import type { AlbumCandidate, AlbumResult, SearchCandidate, SearchResult } from './types.js';

/** Alan seçerken platform önceliği: metadata en temiz olandan başla. */
const METADATA_PRIORITY: Platform[] = ['spotify', 'deezer', 'apple-music', 'youtube-music'];
/** Kapak: Apple 3000 px, Deezer 1000 px, Spotify 640 px */
const COVER_PRIORITY: Platform[] = ['apple-music', 'deezer', 'spotify', 'youtube-music'];
/** İndirme akışı için link: Deezer ISRC + albüm verir, anahtarsız çalışır */
const URL_PRIORITY: Platform[] = ['deezer', 'spotify', 'apple-music', 'youtube-music'];

const MIN_RELEVANCE = 0.35;
const VARIANT_PENALTY = 0.25;
const VARIANT_BONUS = 0.1;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const tokenize =(s: string) => normalizeText(s).split(' ').filter(Boolean);

/** Sorgudaki kelimelerin aday metninde geçme oranı (önek ve yazım hatası toleranslı). */
export function tokenCoverage(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const textTokens = tokenize(text);
  let hits = 0;
  for (const q of queryTokens) {
    const found = textTokens.some(
      (t) =>
        t === q ||
        (q.length >= 3 && t.startsWith(q)) ||
        // "rapsody" ~ "rhapsody" gibi yazım hataları
        (q.length >= 5 && t.length >= 5 && stringSimilarity(q, t) >= 0.75),
    );
    if (found) hits++;
  }
  return hits / queryTokens.length;
}

/** Adayın sorguyla ne kadar örtüştüğü (0-1). */
export function relevance(query: string, c: Pick<SearchCandidate, 'title' | 'artist' | 'album'>): number {
  const coverage = tokenCoverage(query, `${c.artist} ${c.title} ${c.album ?? ''}`);
  const similarity = Math.max(
    textSimilarity(query, c.title),
    c.artist ? textSimilarity(query, `${c.artist} ${c.title}`) : 0,
    c.artist ? textSimilarity(query, `${c.title} ${c.artist}`) : 0,
  );
  return 0.65 * coverage + 0.35 * similarity;
}

function sameRecording(a: SearchCandidate, b: SearchCandidate): boolean {
  if (a.isrc && b.isrc) return a.isrc === b.isrc;
  if (!a.artist || !b.artist) return false;
  return scoreTrackMatch(a, b, { durationToleranceSec: 3 }) >= 0.9;
}

function pick<C extends { source: Platform }, T>(members: C[], order: Platform[], get: (c: C) => T | null): T | null {
  for (const platform of order) {
    for (const m of members) {
      if (m.source !== platform) continue;
      const value = get(m);
      if (value !== null && value !== '') return value;
    }
  }
  return null;
}

function toResult(query: string, members: SearchCandidate[], activeSources: number): SearchResult {
  const sources = [...new Set(members.map((m) => m.source))];
  const rel = Math.max(...members.map((m) => relevance(query, m)));
  const position = Math.max(...members.map((m) => 1 / (1 + m.position)));
  const popularity = Math.max(0, ...members.map((m) => m.popularity ?? 0));
  const consensus = sources.length / Math.max(activeSources, 1);
  const title = pick(members, METADATA_PRIORITY, (m) => m.title) ?? members[0]!.title;
  // Sorguda istenmeyen sürüm (live/remix/karaoke…) → ceza; açıkça istenen sürüm → bonus
  const titleVariant = variantKeyword(title);
  const queryVariant = variantKeyword(query);
  let adjustment = 0;
  if (hasUnwantedVariant(query, title)) adjustment -= VARIANT_PENALTY;
  else if (queryVariant && titleVariant === queryVariant) adjustment += VARIANT_BONUS;
  else if (queryVariant && !titleVariant) adjustment -= VARIANT_BONUS;

  // En erken yıl genelde orijinal yayındır (derlemeler sonradan çıkar)
  const dated = members.filter((m) => m.releaseYear).sort((a, b) => Number(a.releaseYear) - Number(b.releaseYear));
  const original = dated[0];

  const isrc = members.find((m) => m.isrc)?.isrc ?? null;
  const links = Object.fromEntries(members.map((m) => [m.source, m.url])) as Partial<Record<Platform, string>>;
  const url = pick(members, URL_PRIORITY, (m) => m.url)!;

  return {
    id: createHash('sha1').update(isrc ?? url).digest('hex').slice(0, 12),
    title,
    artist: pick(members, METADATA_PRIORITY, (m) => m.artist) ?? '',
    album: original?.album ?? pick(members, METADATA_PRIORITY, (m) => m.album),
    releaseYear: original?.releaseYear ?? null,
    coverUrl: pick(members, COVER_PRIORITY, (m) => m.coverUrl),
    duration: pick(members, METADATA_PRIORITY, (m) => m.duration),
    isrc,
    url,
    sources,
    links,
    relevance: Math.round(rel * 1000) / 1000,
    score: Math.round(clamp01(0.5 * rel + 0.2 * consensus + 0.15 * position + 0.15 * popularity + adjustment) * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Albümler
// ---------------------------------------------------------------------------

/** Albüm bölümünde gösterilmek için gereken en düşük sorgu eşleşmesi (gürültüyü keser). */
const MIN_ALBUM_RELEVANCE = 0.6;
/** Albüm linki: Deezer (ISRC'li parça listesi) > Apple Music */
const ALBUM_URL_PRIORITY: Platform[] = ['deezer', 'apple-music', 'spotify', 'youtube-music'];

function sameAlbum(a: AlbumCandidate, b: AlbumCandidate): boolean {
  return titleSimilarity(a.title, b.title) >= 0.9 && artistSimilarity(a.artist, b.artist) >= 0.8;
}

export function albumRelevance(query: string, a: Pick<AlbumCandidate, 'title' | 'artist'>): number {
  const coverage = tokenCoverage(query, `${a.artist} ${a.title}`);
  const similarity = Math.max(textSimilarity(query, a.title), textSimilarity(query, `${a.artist} ${a.title}`));
  return 0.65 * coverage + 0.35 * similarity;
}

/** Albüm adaylarını platformlar arası birleştirir; yalnızca sorguyla güçlü eşleşenleri döndürür. */
export function rankAlbums(query: string, candidates: AlbumCandidate[], limit: number): AlbumResult[] {
  const groups: AlbumCandidate[][] = [];
  for (const c of candidates) {
    const group = groups.find((g) => !g.some((m) => m.source === c.source) && g.some((m) => sameAlbum(m, c)));
    if (group) group.push(c);
    else groups.push([c]);
  }

  const activeSources = new Set(candidates.map((c) => c.source)).size;
  return groups
    .map((members) => {
      const rel = Math.max(...members.map((m) => albumRelevance(query, m)));
      const position = Math.max(...members.map((m) => 1 / (1 + m.position)));
      const sources = [...new Set(members.map((m) => m.source))];
      const url = ALBUM_URL_PRIORITY.flatMap((p) => members.filter((m) => m.source === p)).at(0)!.url;
      const dated = members.filter((m) => m.releaseYear).sort((a, b) => Number(a.releaseYear) - Number(b.releaseYear));
      const result: AlbumResult = {
        id: createHash('sha1').update(url).digest('hex').slice(0, 12),
        title: pick(members, METADATA_PRIORITY, (m) => m.title) ?? members[0]!.title,
        artist: pick(members, METADATA_PRIORITY, (m) => m.artist) ?? members[0]!.artist,
        url,
        coverUrl: pick(members, COVER_PRIORITY, (m) => m.coverUrl),
        trackCount: Math.max(0, ...members.map((m) => m.trackCount ?? 0)) || null,
        releaseYear: dated[0]?.releaseYear ?? null,
        sources,
        score: Math.round(clamp01(0.6 * rel + 0.25 * (sources.length / Math.max(activeSources, 1)) + 0.15 * position) * 1000) / 1000,
      };
      return { result, rel };
    })
    .filter((x) => x.rel >= MIN_ALBUM_RELEVANCE)
    // Sanatçı adı kısmen eşleşiyorsa ("daft punk" ↔ "Data Punk") farklı sanatçıdır
    .filter((x) => {
      const artistCovered = tokenCoverage(x.result.artist, query);
      return artistCovered === 0 || artistCovered === 1;
    })
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit)
    .map((x) => x.result);
}

/**
 * Farklı platformlardan gelen adayları aynı kayıt olacak şekilde gruplar ve sıralar.
 *
 * Skor = %50 sorgu eşleşmesi + %20 platformlar arası uzlaşı (kaç platformda var)
 *      + %15 platformun kendi sıralaması + %15 popülerlik
 *      − (sorguda istenmemiş live/remix/karaoke vb. ise) ceza
 */
export function rankCandidates(query: string, candidates: SearchCandidate[], limit: number): SearchResult[] {
  const groups: SearchCandidate[][] = [];
  for (const candidate of candidates) {
    const group = groups.find((g) => g.some((m) => m.source !== candidate.source && sameRecording(m, candidate)));
    if (group && !group.some((m) => m.source === candidate.source)) group.push(candidate);
    else groups.push([candidate]);
  }

  const activeSources = new Set(candidates.map((c) => c.source)).size;
  const results = groups.map((g) => toResult(query, g, activeSources));
  const relevant = results.filter((r) => r.relevance >= MIN_RELEVANCE);

  return (relevant.length > 0 ? relevant : results).sort((a, b) => b.score - a.score).slice(0, limit);
}
