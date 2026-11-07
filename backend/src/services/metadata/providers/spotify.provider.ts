import axios from 'axios';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { MetadataError, isNotFound } from '../errors.js';
import { http, toProviderError } from '../http.js';
import { joinArtists, MAX_COLLECTION_TRACKS, msToSeconds, toYear } from '../normalize.js';
import type { Collection, CollectionType, MetadataProvider, ParsedMusicUrl, TrackMetadata } from '../types.js';

interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyTrack {
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; release_date?: string; images?: SpotifyImage[] };
  external_ids?: { isrc?: string };
}

/** open.spotify.com/embed sayfasındaki __NEXT_DATA__ içinden okunan alanlar (resmî değil). */
interface SpotifyEmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  artists?: { name?: string }[];
  /** ms */
  duration?: number;
  releaseDate?: { isoString?: string } | null;
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
  trackList?: { uri?: string; title?: string; subtitle?: string; duration?: number; audioPreview?: { url?: string } }[];
}

interface SpotifySimpleTrack {
  id: string;
  type?: string;
  name: string;
  duration_ms: number;
  track_number?: number;
  disc_number?: number;
  artists: { name: string }[];
  external_ids?: { isrc?: string };
  preview_url?: string | null;
}

interface SpotifyPage<T> {
  items: T[];
  next: string | null;
  total?: number;
}

interface SpotifyAlbumResponse {
  name: string;
  release_date?: string;
  total_tracks?: number;
  images?: SpotifyImage[];
  artists: { name: string }[];
  tracks: SpotifyPage<SpotifySimpleTrack>;
}

interface SpotifyPlaylistResponse {
  name: string;
  owner?: { display_name?: string };
  images?: SpotifyImage[] | null;
  tracks: SpotifyPage<{ track: SpotifySimpleTrack | null }>;
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const NEXT_DATA = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function largestImage(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

/**
 * 1) Kimlik bilgileri varsa Spotify Web API (Client Credentials) — ISRC dahil tam veri.
 * 2) Yoksa / başarısızsa public embed sayfası — başlık, sanatçı, süre, yıl, kapak.
 *    (ISRC ve albüm adı embed'de yok; servis bunları Deezer'dan tamamlar.)
 */
export class SpotifyProvider implements MetadataProvider {
  readonly platform = 'spotify' as const;

  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(
    private readonly config = {
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      market: env.SPOTIFY_MARKET,
    },
  ) {}

  get hasCredentials(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  /** Spotify katalog araması (yalnızca API anahtarları tanımlıysa). */
  async searchTracks(query: string, limit: number): Promise<Array<SpotifyTrack & { id: string; popularity?: number }>> {
    const token = await this.getAccessToken();
    try {
      const { data } = await http.get<{ tracks?: { items?: Array<SpotifyTrack & { id: string; popularity?: number }> } }>(
        `${API_BASE}/search`,
        {
          params: { q: query, type: 'track', limit, market: this.config.market },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      return data.tracks?.items ?? [];
    } catch (err) {
      throw toProviderError(err, 'spotify', 'Spotify arama');
    }
  }

  async getTrack(parsed: ParsedMusicUrl): Promise<TrackMetadata> {
    if (this.hasCredentials) {
      try {
        return await this.fromWebApi(parsed.id);
      } catch (err) {
        if (isNotFound(err)) throw err;
        logger.warn({ err, trackId: parsed.id }, 'Spotify Web API başarısız, embed sayfasına geçiliyor');
      }
    }
    return this.fromEmbed(parsed.id);
  }

  // --- Web API -------------------------------------------------------------

  private async fromWebApi(id: string, retried = false): Promise<TrackMetadata> {
    const token = await this.getAccessToken();
    try {
      const { data } = await http.get<SpotifyTrack>(`${API_BASE}/tracks/${id}`, {
        params: { market: this.config.market },
        headers: { Authorization: `Bearer ${token}` },
      });
      return {
        title: data.name,
        artist: joinArtists(data.artists.map((a) => a.name)),
        album: data.album.name,
        releaseDate: toYear(data.album.release_date),
        coverUrl: largestImage(data.album.images),
        isrc: data.external_ids?.isrc ?? null,
        duration: msToSeconds(data.duration_ms),
        genre: null,
      };
    } catch (err) {
      if (!retried && axios.isAxiosError(err) && err.response?.status === 401) {
        this.token = null; // token iptal edilmiş olabilir → bir kez yenile
        return this.fromWebApi(id, true);
      }
      throw toProviderError(err, 'spotify', 'Spotify Web API');
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    // Aynı anda gelen istekler tek bir token isteğini paylaşır
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret } = this.config;
    if (!clientId || !clientSecret) {
      throw new MetadataError('CONFIG_MISSING', 'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET eksik', {
        platform: 'spotify',
      });
    }
    try {
      const { data } = await http.post<{ access_token: string; expires_in: number }>(
        TOKEN_URL,
        new URLSearchParams({ grant_type: 'client_credentials' }),
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
      return data.access_token;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      throw new MetadataError(
        status === 400 || status === 401 ? 'CONFIG_MISSING' : 'PROVIDER_ERROR',
        `Spotify token alınamadı${status ? ` (HTTP ${status})` : ''}`,
        { platform: 'spotify', cause: err },
      );
    }
  }

  // --- Albüm / çalma listesi ----------------------------------------------

  async getCollection(parsed: ParsedMusicUrl): Promise<Collection> {
    if (parsed.type !== 'album' && parsed.type !== 'playlist') {
      throw new MetadataError('UNSUPPORTED_RESOURCE', `Spotify ${parsed.type} desteklenmiyor`, { platform: 'spotify' });
    }
    if (this.hasCredentials) {
      try {
        return await this.collectionFromApi(parsed.type, parsed.id);
      } catch (err) {
        if (isNotFound(err)) throw err;
        logger.warn({ err, id: parsed.id }, 'Spotify koleksiyon API başarısız, embed sayfasına geçiliyor');
      }
    }
    return this.collectionFromEmbed(parsed.type, parsed.id);
  }

  private async apiGet<T>(pathOrUrl: string, params?: Record<string, string | number>): Promise<T> {
    const token = await this.getAccessToken();
    try {
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
      const { data } = await http.get<T>(url, { params, headers: { Authorization: `Bearer ${token}` } });
      return data;
    } catch (err) {
      throw toProviderError(err, 'spotify', 'Spotify Web API');
    }
  }

  private async collectionFromApi(type: CollectionType, id: string): Promise<Collection> {
    const toTrack = (t: SpotifySimpleTrack, i: number, album: boolean) => ({
      position: album ? t.track_number ?? i + 1 : i + 1,
      disc: album ? t.disc_number ?? null : null,
      title: t.name,
      artist: joinArtists(t.artists.map((a) => a.name)),
      duration: msToSeconds(t.duration_ms),
      isrc: t.external_ids?.isrc ?? null,
      url: `https://open.spotify.com/track/${t.id}`,
      previewUrl: t.preview_url ?? null,
    });

    if (type === 'album') {
      const album = await this.apiGet<SpotifyAlbumResponse>(`/albums/${id}`, { market: this.config.market });
      const items = [...album.tracks.items];
      let next = album.tracks.next;
      while (next && items.length < MAX_COLLECTION_TRACKS) {
        const page = await this.apiGet<SpotifyPage<SpotifySimpleTrack>>(next);
        items.push(...page.items);
        next = page.next;
      }
      return {
        platform: 'spotify',
        type,
        id,
        url: `https://open.spotify.com/album/${id}`,
        title: album.name,
        artist: joinArtists(album.artists.map((a) => a.name)),
        coverUrl: largestImage(album.images),
        releaseYear: toYear(album.release_date),
        totalTracks: album.total_tracks ?? items.length,
        tracks: items.slice(0, MAX_COLLECTION_TRACKS).map((t, i) => toTrack(t, i, true)),
      };
    }

    const playlist = await this.apiGet<SpotifyPlaylistResponse>(`/playlists/${id}`, { market: this.config.market });
    const entries = [...playlist.tracks.items];
    let next = playlist.tracks.next;
    while (next && entries.length < MAX_COLLECTION_TRACKS) {
      const page = await this.apiGet<SpotifyPage<{ track: SpotifySimpleTrack | null }>>(next);
      entries.push(...page.items);
      next = page.next;
    }
    // Podcast bölümleri ve silinmiş parçalar atlanır
    const tracks = entries
      .map((e) => e.track)
      .filter((t): t is SpotifySimpleTrack => Boolean(t?.id) && (t?.type ?? 'track') === 'track');
    return {
      platform: 'spotify',
      type,
      id,
      url: `https://open.spotify.com/playlist/${id}`,
      title: playlist.name,
      artist: playlist.owner?.display_name ?? null,
      coverUrl: largestImage(playlist.images ?? undefined),
      releaseYear: null,
      totalTracks: playlist.tracks.total ?? tracks.length,
      tracks: tracks.slice(0, MAX_COLLECTION_TRACKS).map((t, i) => toTrack(t, i, false)),
    };
  }

  /** Anahtarsız: embed sayfasındaki parça listesi (çalma listelerinde ilk ~100 parça). */
  private async collectionFromEmbed(type: CollectionType, id: string): Promise<Collection> {
    let html: string;
    try {
      ({ data: html } = await http.get<string>(`https://open.spotify.com/embed/${type}/${id}`, { responseType: 'text' }));
    } catch (err) {
      throw toProviderError(err, 'spotify', 'Spotify embed');
    }

    let entity: SpotifyEmbedEntity | undefined;
    try {
      const raw = NEXT_DATA.exec(html)?.[1];
      entity = raw ? JSON.parse(raw)?.props?.pageProps?.state?.data?.entity : undefined;
    } catch {
      entity = undefined;
    }
    if (!entity?.trackList) {
      throw new MetadataError(
        'PROVIDER_ERROR',
        'Spotify embed sayfası parça listesi içermiyor. Spotify API anahtarlarını tanımlayın.',
        { platform: 'spotify' },
      );
    }

    const images = entity.visualIdentity?.image ?? [];
    const tracks = entity.trackList
      .map((t) => ({ ...t, trackId: /^spotify:track:([A-Za-z0-9]{22})$/.exec(t.uri ?? '')?.[1] }))
      .filter((t) => t.trackId && t.title);

    return {
      platform: 'spotify',
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
      title: entity.name ?? entity.title ?? 'Spotify',
      artist: entity.subtitle ?? null,
      coverUrl: [...images].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.url ?? null,
      releaseYear: toYear(entity.releaseDate?.isoString),
      totalTracks: tracks.length,
      tracks: tracks.slice(0, MAX_COLLECTION_TRACKS).map((t, i) => ({
        position: i + 1,
        disc: null,
        title: t.title!,
        artist: t.subtitle ?? entity!.subtitle ?? '',
        duration: msToSeconds(t.duration),
        isrc: null,
        url: `https://open.spotify.com/track/${t.trackId}`,
        previewUrl: t.audioPreview?.url ?? null,
      })),
    };
  }

  // --- Embed fallback ------------------------------------------------------

  private async fromEmbed(id: string): Promise<TrackMetadata> {
    let html: string;
    try {
      ({ data: html } = await http.get<string>(`https://open.spotify.com/embed/track/${id}`, {
        responseType: 'text',
      }));
    } catch (err) {
      throw toProviderError(err, 'spotify', 'Spotify embed');
    }

    const raw = NEXT_DATA.exec(html)?.[1];
    let entity: SpotifyEmbedEntity | undefined;
    try {
      entity = raw ? JSON.parse(raw)?.props?.pageProps?.state?.data?.entity : undefined;
    } catch {
      entity = undefined;
    }
    const title = entity?.name ?? entity?.title;
    if (!entity || !title) {
      throw new MetadataError(
        'PROVIDER_ERROR',
        'Spotify embed sayfası beklenen veriyi içermiyor (sayfa yapısı değişmiş olabilir). Spotify API anahtarlarını tanımlayın.',
        { platform: 'spotify' },
      );
    }

    const images = entity.visualIdentity?.image ?? [];
    const cover = [...images].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.url ?? null;
    const artists = entity.artists?.map((a) => a.name) ?? [];

    return {
      title,
      artist: joinArtists(artists.length > 0 ? artists : [entity.subtitle]),
      album: null,
      releaseDate: toYear(entity.releaseDate?.isoString),
      coverUrl: cover,
      isrc: null,
      duration: msToSeconds(entity.duration),
      genre: null,
    };
  }
}
