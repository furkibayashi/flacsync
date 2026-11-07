import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ytDlpJson, type YtDlpFlatEntry } from '../utils/ytdlp.js';
import { http } from './metadata/http.js';
import { msToSeconds, normalizeIsrc, toYear } from './metadata/normalize.js';
import { SpotifyProvider } from './metadata/providers/spotify.provider.js';
import type { Platform } from './metadata/types.js';
import { artistSimilarity, splitArtists, stripTitleNoise, titleSimilarity } from './matcher/similarity.js';
import { rankAlbums, rankCandidates } from './search/ranking.js';
import type { AlbumCandidate, AlbumResult, SearchCandidate, SearchResponse, SourceStatus } from './search/types.js';

export type { AlbumResult, SearchCandidate, SearchResponse, SearchResult } from './search/types.js';

/** Kaynak başına sonuç: "daha fazla göster" için istenen limitle büyür */
const perSourceLimit = (limit: number) => Math.min(30, Math.max(15, limit + 5));
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

interface DeezerAlbum {
  id: number;
  title: string;
  link?: string;
  cover_xl?: string;
  cover_big?: string;
  nb_tracks?: number;
  record_type?: string;
  artist: { name: string };
}

interface ITunesAlbum {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
  trackCount?: number;
  releaseDate?: string;
}

const ALBUM_LIMIT = 4;

function deezerAlbumToCandidate(a: DeezerAlbum, position: number): AlbumCandidate {
  return {
    source: 'deezer',
    title: a.title,
    artist: a.artist.name,
    url: a.link ?? `https://www.deezer.com/album/${a.id}`,
    coverUrl: a.cover_xl ?? a.cover_big ?? null,
    trackCount: a.nb_tracks ?? null,
    releaseYear: null,
    position,
  };
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

    // Albümler şarkılarla paralel aranır; başarısız olursa bölüm boş kalır
    const albumsPromise = this.searchAlbums(q).catch((err) => {
      logger.warn({ err }, 'Albüm araması başarısız');
      return [] as AlbumCandidate[];
    });

    const tasks: Array<[Platform, Promise<SearchCandidate[]>]> = [
      ['deezer', this.searchDeezer(q, perSourceLimit(limit))],
      ['apple-music', this.searchITunes(q, perSourceLimit(limit))],
    ];
    if (this.spotify.hasCredentials) tasks.push(['spotify', this.searchSpotify(q, perSourceLimit(limit))]);

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
    const albums = rankAlbums(q, await albumsPromise, ALBUM_LIMIT);
    if (results.length === 0 && albums.length === 0) throw new SearchError(`"${q}" için sonuç bulunamadı`);

    const response: SearchResponse = { query: q, best: results[0] ?? null, results, albums, sources };
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value: response, expiresAt: Date.now() + CACHE_TTL_MS });
    return response;
  }

  /**
   * Bir şarkının albümünü bulur (şarkı ekranındaki "Albümü aç" için).
   * Tek parçalık single'lar döndürülmez — açmanın anlamı yok.
   */
  async findAlbum(artist: string, album: string): Promise<AlbumResult | null> {
    const primaryArtist = splitArtists(artist)[0] ?? artist;
    const cleanAlbum = stripTitleNoise(album);
    const { data } = await http.get<{ data?: DeezerAlbum[] }>(`${env.DEEZER_API_BASE_URL}/search/album`, {
      params: { q: `${primaryArtist} ${cleanAlbum}`, limit: 10 },
    });

    const best = (data.data ?? [])
      .filter((a) => (a.nb_tracks ?? 0) > 2)
      .map((a) => ({ a, title: titleSimilarity(cleanAlbum, a.title), artist: artistSimilarity(artist, a.artist.name) }))
      .filter((x) => x.title >= 0.85 && x.artist >= 0.7)
      // Aynı adlı albümlerde (deluxe vb.) en çok parçalı olan
      .sort((x, y) => y.title + y.artist - (x.title + x.artist) || (y.a.nb_tracks ?? 0) - (x.a.nb_tracks ?? 0))[0];
    if (!best) return null;

    return rankAlbums(`${best.a.artist.name} ${best.a.title}`, [deezerAlbumToCandidate(best.a, 0)], 1)[0] ?? null;
  }

  // -------------------------------------------------------------------------

  private async searchAlbums(q: string): Promise<AlbumCandidate[]> {
    const [deezer, itunes] = await Promise.allSettled([
      http.get<{ data?: DeezerAlbum[] }>(`${env.DEEZER_API_BASE_URL}/search/album`, { params: { q, limit: 10 } }),
      http.get<{ results?: ITunesAlbum[] }>('https://itunes.apple.com/search', {
        params: { term: q, entity: 'album', limit: 10, country: env.APPLE_MUSIC_STOREFRONT },
      }),
    ]);

    const candidates: AlbumCandidate[] = [];
    if (deezer.status === 'fulfilled') {
      (deezer.value.data.data ?? [])
        // Single'ları ele: şarkı aramasında zaten görünüyorlar
        .filter((a) => a.record_type !== 'single' || (a.nb_tracks ?? 0) > 3)
        .forEach((a, i) => candidates.push(deezerAlbumToCandidate(a, i)));
    }
    if (itunes.status === 'fulfilled') {
      const store = env.APPLE_MUSIC_STOREFRONT;
      (itunes.value.data.results ?? [])
        .filter((a) => a.collectionId && a.collectionName && !/\s-\sSingle$/i.test(a.collectionName))
        .forEach((a, position) =>
          candidates.push({
            source: 'apple-music',
            title: a.collectionName!.replace(/\s-\s(?:EP)$/i, ''),
            artist: a.artistName ?? '',
            url: `https://music.apple.com/${store}/album/${a.collectionId}`,
            coverUrl: a.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/3000x3000bb.') ?? null,
            trackCount: a.trackCount ?? null,
            releaseYear: toYear(a.releaseDate),
            position,
          }),
        );
    }
    return candidates;
  }

  private async searchDeezer(q: string, perSource: number): Promise<SearchCandidate[]> {
    const { data } = await http.get<{ data?: DeezerSearchTrack[]; error?: { message: string } }>(
      `${env.DEEZER_API_BASE_URL}/search`,
      { params: { q, limit: perSource } },
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

  private async searchITunes(q: string, perSource: number): Promise<SearchCandidate[]> {
    const { data } = await http.get<{ results?: ITunesSearchResult[] }>('https://itunes.apple.com/search', {
      params: { term: q, entity: 'song', limit: perSource, country: env.APPLE_MUSIC_STOREFRONT },
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

  private async searchSpotify(q: string, perSource: number): Promise<SearchCandidate[]> {
    const items = await this.spotify.searchTracks(q, perSource);
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
