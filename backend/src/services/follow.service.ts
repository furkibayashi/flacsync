import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/json-store.js';
import { logger } from '../utils/logger.js';
import { http } from './metadata/http.js';
import { toYear } from './metadata/normalize.js';

/**
 * Takip edilen sanatçılar ve onların yeni çıkanları (Deezer). Ana sayfada
 * "Takip ettiklerinden yeni çıkanlar" olarak gösterilir.
 */

export interface FollowedArtist {
  id: string;
  name: string;
  pictureUrl: string | null;
  followedAt: string;
}

export interface Release {
  id: string;
  title: string;
  artistId: string;
  artist: string;
  coverUrl: string | null;
  releaseDate: string;
  releaseYear: string | null;
  type: 'album' | 'single' | 'ep' | 'compilation';
  url: string;
}

interface DeezerAlbum {
  id: number;
  title: string;
  link?: string;
  cover_xl?: string;
  cover_big?: string;
  release_date?: string;
  record_type?: string;
}

const RELEASE_WINDOW_DAYS = 120;
const CACHE_TTL_MS = 60 * 60_000;
const MAX_FOLLOWS = 500;
const TYPE: Record<string, Release['type']> = { album: 'album', single: 'single', ep: 'ep', compile: 'compilation' };

function isFollow(v: unknown): v is FollowedArtist {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return typeof f.id === 'string' && /^\d+$/.test(f.id) && typeof f.name === 'string';
}

export class FollowService {
  private readonly store: JsonStore<FollowedArtist[]>;
  private releasesCache: { value: Release[]; key: string; expiresAt: number } | null = null;

  constructor(dataDir = resolve(env.DATA_DIR)) {
    this.store = new JsonStore<FollowedArtist[]>(join(dataDir, 'follows.json'), [], (raw) =>
      Array.isArray(raw) ? raw.filter(isFollow) : null,
    );
  }

  list(): FollowedArtist[] {
    return [...this.store.data].sort((a, b) => a.name.localeCompare(b.name));
  }

  isFollowing(id: string): boolean {
    return this.store.data.some((f) => f.id === id);
  }

  follow(artist: { id: string; name: string; pictureUrl?: string | null }): FollowedArtist {
    const existing = this.store.data.find((f) => f.id === artist.id);
    if (existing) return existing;
    const entry: FollowedArtist = {
      id: artist.id,
      name: artist.name,
      pictureUrl: artist.pictureUrl ?? null,
      followedAt: new Date().toISOString(),
    };
    this.store.set([...this.store.data, entry].slice(-MAX_FOLLOWS));
    this.releasesCache = null;
    return entry;
  }

  unfollow(id: string): boolean {
    const before = this.store.data.length;
    this.store.set(this.store.data.filter((f) => f.id !== id));
    this.releasesCache = null;
    return this.store.data.length < before;
  }

  /** Son 120 günde çıkan albüm / single'lar, en yeni önce. */
  async releases(): Promise<Release[]> {
    const follows = this.store.data;
    const key = follows.map((f) => f.id).join(',');
    if (this.releasesCache && this.releasesCache.key === key && this.releasesCache.expiresAt > Date.now()) {
      return this.releasesCache.value;
    }
    const since = Date.now() - RELEASE_WINDOW_DAYS * 86_400_000;
    const results: Release[] = [];
    // Deezer'ı boğmamak için sırayla, 6'şar
    for (let i = 0; i < follows.length; i += 6) {
      const chunk = follows.slice(i, i + 6);
      const pages = await Promise.all(
        chunk.map((f) =>
          http
            .get<{ data?: DeezerAlbum[] }>(`${env.DEEZER_API_BASE_URL}/artist/${f.id}/albums`, { params: { limit: 25 } })
            .then((r) => ({ f, albums: r.data.data ?? [] }))
            .catch((err: unknown) => {
              logger.debug({ err, artist: f.name }, 'Sanatçının albümleri alınamadı');
              return { f, albums: [] as DeezerAlbum[] };
            }),
        ),
      );
      for (const { f, albums } of pages) {
        for (const a of albums) {
          if (!a.release_date || Date.parse(a.release_date) < since) continue;
          results.push({
            id: String(a.id),
            title: a.title,
            artistId: f.id,
            artist: f.name,
            coverUrl: a.cover_xl ?? a.cover_big ?? null,
            releaseDate: a.release_date,
            releaseYear: toYear(a.release_date),
            type: TYPE[a.record_type ?? 'album'] ?? 'album',
            url: a.link ?? `https://www.deezer.com/album/${a.id}`,
          });
        }
      }
    }
    const seen = new Set<string>();
    const value = results
      .filter((r) => {
        const k = `${r.artistId}|${r.title.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
      .slice(0, 60);
    this.releasesCache = { value, key, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}

export const followService = new FollowService();
