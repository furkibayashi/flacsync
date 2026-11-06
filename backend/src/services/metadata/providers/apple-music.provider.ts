import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { MetadataError, isNotFound } from '../errors.js';
import { http, toProviderError } from '../http.js';
import { MAX_COLLECTION_TRACKS, msToSeconds, toYear } from '../normalize.js';
import type { Collection, MetadataProvider, ParsedMusicUrl, TrackMetadata } from '../types.js';

interface AppleSongAttributes {
  name: string;
  artistName: string;
  albumName?: string;
  releaseDate?: string;
  durationInMillis?: number;
  isrc?: string;
  artwork?: { url: string; width?: number; height?: number };
}

interface AppleSongsResponse {
  data: { id: string; attributes?: AppleSongAttributes }[];
}

interface AppleSongResource {
  id: string;
  type: string;
  attributes?: AppleSongAttributes;
}

interface ApplePlaylistResponse {
  data: {
    id: string;
    attributes?: { name: string; curatorName?: string; artwork?: { url: string; width?: number } };
    relationships?: { tracks?: { data: AppleSongResource[]; next?: string } };
  }[];
}

interface ITunesLookupResponse {
  resultCount: number;
  results: {
    wrapperType?: string;
    kind?: string;
    trackId?: number;
    trackNumber?: number;
    discNumber?: number;
    trackCount?: number;
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    releaseDate?: string;
    artworkUrl100?: string;
    trackTimeMillis?: number;
  }[];
}

const API_BASE = 'https://api.music.apple.com/v1';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const TOKEN_TTL_SEC = 12 * 60 * 60;
const COVER_SIZE = 3000;

/**
 * 1) MusicKit kimlik bilgileri varsa Apple Music API — ISRC dahil tam veri.
 * 2) Yoksa iTunes Search/Lookup API (anahtarsız) — ISRC hariç her şey.
 */
export class AppleMusicProvider implements MetadataProvider {
  readonly platform = 'apple-music' as const;

  private devToken: { value: string; expiresAt: number } | null = null;
  private privateKey: string | null | undefined; // undefined = henüz yüklenmedi

  async getTrack(parsed: ParsedMusicUrl): Promise<TrackMetadata> {
    const storefront = parsed.storefront ?? env.APPLE_MUSIC_STOREFRONT;

    if (this.canUseApi()) {
      try {
        return await this.fromApi(parsed.id, storefront);
      } catch (err) {
        if (isNotFound(err)) throw err;
        logger.warn({ err, songId: parsed.id }, 'Apple Music API başarısız, iTunes Lookup API’ye geçiliyor');
      }
    } else if (!env.APPLE_MUSIC_USE_ITUNES_FALLBACK) {
      throw new MetadataError(
        'CONFIG_MISSING',
        'Apple Music anahtarları eksik ve APPLE_MUSIC_USE_ITUNES_FALLBACK=false',
        { platform: 'apple-music' },
      );
    }
    return this.fromItunes(parsed.id, storefront);
  }

  // --- Apple Music API -----------------------------------------------------

  private async fromApi(id: string, storefront: string): Promise<TrackMetadata> {
    let body: AppleSongsResponse;
    try {
      ({ data: body } = await http.get<AppleSongsResponse>(
        `${API_BASE}/catalog/${storefront}/songs/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${this.getDeveloperToken()}` } },
      ));
    } catch (err) {
      throw toProviderError(err, 'apple-music', 'Apple Music API');
    }

    const a = body.data[0]?.attributes;
    if (!a) throw new MetadataError('NOT_FOUND', `Apple Music şarkısı bulunamadı: ${id}`, { platform: 'apple-music' });

    const size = Math.min(a.artwork?.width ?? COVER_SIZE, COVER_SIZE);
    return {
      title: a.name,
      artist: a.artistName,
      album: a.albumName ?? null,
      releaseDate: toYear(a.releaseDate),
      coverUrl: a.artwork?.url.replace('{w}', String(size)).replace('{h}', String(size)) ?? null,
      isrc: a.isrc ?? null,
      duration: msToSeconds(a.durationInMillis),
    };
  }

  private canUseApi(): boolean {
    return Boolean(env.APPLE_MUSIC_TEAM_ID && env.APPLE_MUSIC_KEY_ID && this.loadPrivateKey());
  }

  private loadPrivateKey(): string | null {
    if (this.privateKey !== undefined) return this.privateKey;

    if (env.APPLE_MUSIC_PRIVATE_KEY) {
      this.privateKey = env.APPLE_MUSIC_PRIVATE_KEY.replace(/\\n/g, '\n');
    } else if (env.APPLE_MUSIC_PRIVATE_KEY_PATH) {
      const path = resolve(env.APPLE_MUSIC_PRIVATE_KEY_PATH);
      if (existsSync(path)) {
        this.privateKey = readFileSync(path, 'utf8');
      } else {
        logger.warn({ path }, 'Apple Music .p8 anahtarı bulunamadı, iTunes Lookup API kullanılacak');
        this.privateKey = null;
      }
    } else {
      this.privateKey = null;
    }
    return this.privateKey;
  }

  /** MusicKit developer token (ES256 JWT), 12 saat önbelleklenir. */
  private getDeveloperToken(): string {
    if (this.devToken && Date.now() < this.devToken.expiresAt - 5 * 60_000) return this.devToken.value;

    const key = this.loadPrivateKey();
    if (!key || !env.APPLE_MUSIC_TEAM_ID || !env.APPLE_MUSIC_KEY_ID) {
      throw new MetadataError('CONFIG_MISSING', 'Apple Music anahtarları eksik', { platform: 'apple-music' });
    }
    const value = jwt.sign({}, key, {
      algorithm: 'ES256',
      issuer: env.APPLE_MUSIC_TEAM_ID,
      expiresIn: TOKEN_TTL_SEC,
      keyid: env.APPLE_MUSIC_KEY_ID,
    });
    this.devToken = { value, expiresAt: Date.now() + TOKEN_TTL_SEC * 1000 };
    return value;
  }

  // --- Albüm / çalma listesi ----------------------------------------------

  async getCollection(parsed: ParsedMusicUrl): Promise<Collection> {
    const storefront = parsed.storefront ?? env.APPLE_MUSIC_STOREFRONT;
    if (parsed.type === 'album') return this.albumFromItunes(parsed.id, storefront);
    if (parsed.type === 'playlist') {
      if (!this.canUseApi()) {
        throw new MetadataError(
          'CONFIG_MISSING',
          'Apple Music çalma listeleri için MusicKit API anahtarı gerekli (albümler anahtarsız çalışır).',
          { platform: 'apple-music' },
        );
      }
      return this.playlistFromApi(parsed.id, storefront);
    }
    throw new MetadataError('UNSUPPORTED_RESOURCE', `Apple Music ${parsed.type} desteklenmiyor`, { platform: 'apple-music' });
  }

  private async albumFromItunes(id: string, storefront: string): Promise<Collection> {
    let body: ITunesLookupResponse;
    try {
      ({ data: body } = await http.get<ITunesLookupResponse>(ITUNES_LOOKUP, {
        params: { id, country: storefront, entity: 'song', limit: 200 },
      }));
    } catch (err) {
      throw toProviderError(err, 'apple-music', 'iTunes Lookup API');
    }
    const album = body.results.find((r) => r.wrapperType === 'collection');
    if (!album?.collectionName) {
      throw new MetadataError('NOT_FOUND', `Apple Music albümü bulunamadı: ${id} (${storefront})`, { platform: 'apple-music' });
    }
    const songs = body.results
      .filter((r) => r.wrapperType === 'track' && r.kind === 'song' && r.trackId && r.trackName)
      .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));

    return {
      platform: 'apple-music',
      type: 'album',
      id,
      url: `https://music.apple.com/${storefront}/album/${id}`,
      title: album.collectionName,
      artist: album.artistName ?? null,
      coverUrl: album.artworkUrl100?.replace(/\/\d+x\d+bb\./, `/${COVER_SIZE}x${COVER_SIZE}bb.`) ?? null,
      releaseYear: toYear(album.releaseDate),
      totalTracks: album.trackCount ?? songs.length,
      tracks: songs.slice(0, MAX_COLLECTION_TRACKS).map((s, i) => ({
        position: s.trackNumber ?? i + 1,
        disc: s.discNumber ?? null,
        title: s.trackName!,
        artist: s.artistName ?? album.artistName ?? '',
        duration: msToSeconds(s.trackTimeMillis),
        isrc: null,
        url: `https://music.apple.com/${storefront}/album/${id}?i=${s.trackId}`,
      })),
    };
  }

  private async playlistFromApi(id: string, storefront: string): Promise<Collection> {
    const get = async <T>(pathOrUrl: string): Promise<T> => {
      try {
        const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.music.apple.com${pathOrUrl}`;
        const { data } = await http.get<T>(url, { headers: { Authorization: `Bearer ${this.getDeveloperToken()}` } });
        return data;
      } catch (err) {
        throw toProviderError(err, 'apple-music', 'Apple Music API');
      }
    };

    const body = await get<ApplePlaylistResponse>(`/v1/catalog/${storefront}/playlists/${encodeURIComponent(id)}`);
    const playlist = body.data[0];
    if (!playlist) throw new MetadataError('NOT_FOUND', `Apple Music çalma listesi bulunamadı: ${id}`, { platform: 'apple-music' });

    const songs = [...(playlist.relationships?.tracks?.data ?? [])];
    let next = playlist.relationships?.tracks?.next;
    while (next && songs.length < MAX_COLLECTION_TRACKS) {
      const page = await get<{ data: AppleSongResource[]; next?: string }>(next);
      songs.push(...page.data);
      next = page.next;
    }
    const artwork = playlist.attributes?.artwork;
    const size = Math.min(artwork?.width ?? COVER_SIZE, COVER_SIZE);

    return {
      platform: 'apple-music',
      type: 'playlist',
      id,
      url: `https://music.apple.com/${storefront}/playlist/${id}`,
      title: playlist.attributes?.name ?? 'Apple Music',
      artist: playlist.attributes?.curatorName ?? null,
      coverUrl: artwork?.url.replace('{w}', String(size)).replace('{h}', String(size)) ?? null,
      releaseYear: null,
      totalTracks: songs.length,
      tracks: songs
        .filter((s) => s.type === 'songs' && s.attributes)
        .slice(0, MAX_COLLECTION_TRACKS)
        .map((s, i) => ({
          position: i + 1,
          disc: null,
          title: s.attributes!.name,
          artist: s.attributes!.artistName,
          duration: msToSeconds(s.attributes!.durationInMillis),
          isrc: s.attributes!.isrc ?? null,
          url: `https://music.apple.com/${storefront}/song/${s.id}`,
        })),
    };
  }

  // --- iTunes Lookup fallback ----------------------------------------------

  private async fromItunes(id: string, storefront: string): Promise<TrackMetadata> {
    let body: ITunesLookupResponse;
    try {
      ({ data: body } = await http.get<ITunesLookupResponse>(ITUNES_LOOKUP, {
        params: { id, country: storefront, entity: 'song' },
      }));
    } catch (err) {
      throw toProviderError(err, 'apple-music', 'iTunes Lookup API');
    }

    const song = body.results.find((r) => r.wrapperType === 'track' && r.kind === 'song') ?? body.results[0];
    if (!song?.trackName || !song.artistName) {
      throw new MetadataError('NOT_FOUND', `Apple Music şarkısı bulunamadı: ${id} (${storefront})`, {
        platform: 'apple-music',
      });
    }

    return {
      title: song.trackName,
      artist: song.artistName,
      album: song.collectionName ?? null,
      releaseDate: toYear(song.releaseDate),
      coverUrl: song.artworkUrl100?.replace(/\/\d+x\d+bb\./, `/${COVER_SIZE}x${COVER_SIZE}bb.`) ?? null,
      isrc: null, // iTunes API ISRC döndürmez → servis Deezer'dan tamamlar
      duration: msToSeconds(song.trackTimeMillis),
    };
  }
}
