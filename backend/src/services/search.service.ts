import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ytDlpJson, type YtDlpFlatEntry } from '../utils/ytdlp.js';
import { http } from './metadata/http.js';
import { msToSeconds, normalizeIsrc, toYear } from './metadata/normalize.js';
import { SpotifyProvider } from './metadata/providers/spotify.provider.js';
import type { Platform } from './metadata/types.js';
import { rankCandidates } from './search/ranking.js';
import type { SearchCandidate, SearchResponse, SourceStatus } from './search/types.js';

export type { SearchCandidate, SearchResponse, SearchResult } from './search/types.js';

const PER_SOURCE_LIMIT = 15;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

interface DeezerSearchTrack {
  id: number;
  title: string;
  link?: string;
  duration?: number;
  rank?: number;
  artist: { name: string };
  album?: { title?: string; cover_xl?: string; cover_big?: string };
}

interface ITunesSearchResult {
  trackId: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionId?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
  kind?: string;
}

export class SearchError extends Error {
  readonly statusCode = 404;
  readonly code = 'NO_RESULTS';
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

/**
 * Çoklu platform arama: şarkı adını Deezer, Apple Music ve (anahtar varsa) Spotify'da
 * paralel arar, aynı kaydı birleştirir ve en iyi sonucu üste koyar.
 * Hiçbiri sonuç vermezse YouTube Music'e düşer.
 */
export class SearchService {
  private readonly cache = new Map<string, { value: SearchResponse; expiresAt: number }>();

  constructor(private readonly spotify = new SpotifyProvider()) {}

  async search(query: string, limit = 8): Promise<SearchResponse> {
    const q = query.trim().replace(/\s+/g, ' ');
    const key = `${q.toLowerCase()}|${limit}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const sources: Record<Platform, SourceStatus> = {
      deezer: 'empty',
      'apple-music': 'empty',
      spotify: this.spotify.hasCredentials ? 'empty' : 'skipped',
      'youtube-music': 'skipped',
    };

    const tasks: Array<[Platform, Promise<SearchCandidate[]>]> = [
      ['deezer', this.searchDeezer(q)],
      ['apple-music', this.searchITunes(q)],
    ];
    if (this.spotify.hasCredentials) tasks.push(['spotify', this.searchSpotify(q)]);

    const settled = await Promise.allSettled(tasks.map(([, p]) => p));
    let candidates: SearchCandidate[] = [];
    settled.forEach((result, i) => {
      const platform = tasks[i]![0];
      if (result.status === 'fulfilled') {
        sources[platform] = result.value.length > 0 ? 'ok' : 'empty';
        candidates.push(...result.value);
      } else {
        sources[platform] = 'error';
        logger.warn({ err: result.reason, platform }, 'Arama kaynağı başarısız');
      }
    });

    // Yaygın kataloglarda yoksa (bağımsız yüklemeler vb.) YouTube Music'e bak
    if (candidates.length === 0) {
      try {
        candidates = await this.searchYouTubeMusic(q);
        sources['youtube-music'] = candidates.length > 0 ? 'ok' : 'empty';
      } catch (err) {
        sources['youtube-music'] = 'error';
        logger.warn({ err }, 'YouTube Music araması başarısız');
      }
    }

    const results = rankCandidates(q, candidates, limit);
    if (results.length === 0) throw new SearchError(`"${q}" için sonuç bulunamadı`);

    const response: SearchResponse = { query: q, best: results[0] ?? null, results, sources };
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value: response, expiresAt: Date.now() + CACHE_TTL_MS });
    return response;
  }

  // -------------------------------------------------------------------------

  private async searchDeezer(q: string): Promise<SearchCandidate[]> {
    const { data } = await http.get<{ data?: DeezerSearchTrack[]; error?: { message: string } }>(
      `${env.DEEZER_API_BASE_URL}/search`,
      { params: { q, limit: PER_SOURCE_LIMIT } },
    );
    if (data.error) throw new Error(`Deezer: ${data.error.message}`);
    return (data.data ?? []).map((t, position) => ({
      source: 'deezer' as const,
      sourceId: String(t.id),
      url: t.link ?? `https://www.deezer.com/track/${t.id}`,
      title: t.title,
      artist: t.artist.name,
      album: t.album?.title ?? null,
      releaseYear: null, // arama sonucunda yok; seçilince parse adımında gelir
      coverUrl: t.album?.cover_xl ?? t.album?.cover_big ?? null,
      duration: t.duration ?? null,
      isrc: null,
      position,
      // Deezer rank ~0-1.000.000 → log ölçek
      popularity: t.rank ? Math.min(1, Math.log10(t.rank + 1) / 6) : null,
    }));
  }

  private async searchITunes(q: string): Promise<SearchCandidate[]> {
    const { data } = await http.get<{ results?: ITunesSearchResult[] }>('https://itunes.apple.com/search', {
      params: { term: q, entity: 'song', limit: PER_SOURCE_LIMIT, country: env.APPLE_MUSIC_STOREFRONT },
    });
    return (data.results ?? [])
      .filter((r) => r.kind === 'song' && r.trackName && r.artistName)
      .map((r, position) => ({
        source: 'apple-music' as const,
        sourceId: String(r.trackId),
        url:
          r.collectionId !== undefined
            ? `https://music.apple.com/${env.APPLE_MUSIC_STOREFRONT}/album/${r.collectionId}?i=${r.trackId}`
            : r.trackViewUrl ?? `https://music.apple.com/${env.APPLE_MUSIC_STOREFRONT}/song/${r.trackId}`,
        title: r.trackName!,
        artist: r.artistName!,
        album: r.collectionName ?? null,
        releaseYear: toYear(r.releaseDate),
        coverUrl: r.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/3000x3000bb.') ?? null,
        duration: msToSeconds(r.trackTimeMillis),
        isrc: null,
        position,
        popularity: null,
      }));
  }

  private async searchSpotify(q: string): Promise<SearchCandidate[]> {
    const items = await this.spotify.searchTracks(q, PER_SOURCE_LIMIT);
    return items.map((t, position) => ({
      source: 'spotify' as const,
      sourceId: t.id,
      url: `https://open.spotify.com/track/${t.id}`,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album.name,
      releaseYear: toYear(t.album.release_date),
      coverUrl: [...(t.album.images ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
      duration: msToSeconds(t.duration_ms),
      isrc: normalizeIsrc(t.external_ids?.isrc),
      position,
      popularity: typeof t.popularity === 'number' ? t.popularity / 100 : null,
    }));
  }

  private async searchYouTubeMusic(q: string): Promise<SearchCandidate[]> {
    const res = await ytDlpJson<{ entries?: YtDlpFlatEntry[] }>(
      `https://music.youtube.com/search?q=${encodeURIComponent(q)}#songs`,
      { flatPlaylist: true, playlistEnd: 10 },
    );
    return (res.entries ?? [])
      .filter((e) => e.id && e.title)
      .map((e, position) => ({
        source: 'youtube-music' as const,
        sourceId: e.id,
        url: `https://music.youtube.com/watch?v=${e.id}`,
        title: e.title!,
        artist: e.channel?.replace(/\s*-\s*Topic$/i, '') ?? '',
        album: null,
        releaseYear: null,
        coverUrl: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
        duration: e.duration ?? null,
        isrc: null,
        position,
        popularity: null,
      }));
  }
}

export const searchService = new SearchService();
