import { env } from '../config/env.js';
import { artistSimilarity } from './matcher/similarity.js';
import { MetadataError } from './metadata/errors.js';
import { http, toProviderError } from './metadata/http.js';
import { stableDeezerPreview } from './metadata/deezer-preview.js';
import { toYear } from './metadata/normalize.js';

/**
 * Sanatçı profili (Deezer herkese açık API): en popüler şarkılar (30 sn önizlemeli),
 * albümler / tekliler ve benzer sanatçılar. Şarkı ve albüm linkleri indirme akışına verilir.
 */

export interface ArtistSummary {
  id: string;
  name: string;
  pictureUrl: string | null;
  fans: number | null;
}

export interface ArtistTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  duration: number | null;
  previewUrl: string | null;
  /** İndirme akışına verilecek Deezer şarkı linki */
  url: string;
}

export interface ArtistAlbum {
  id: string;
  title: string;
  coverUrl: string | null;
  releaseYear: string | null;
  type: 'album' | 'single' | 'ep' | 'compilation';
  url: string;
}

export interface ArtistProfile {
  artist: ArtistSummary & { albumCount: number | null };
  topTracks: ArtistTrack[];
  albums: ArtistAlbum[];
  related: ArtistSummary[];
}

interface DeezerArtist {
  id: number;
  name: string;
  picture_xl?: string;
  picture_big?: string;
  nb_fan?: number;
  nb_album?: number;
}

interface DeezerTopTrack {
  id: number;
  title: string;
  duration?: number;
  preview?: string;
  link?: string;
  artist: { name: string };
  contributors?: { name: string; role?: string }[];
  album?: { title: string; cover_xl?: string; cover_big?: string };
}

interface DeezerArtistAlbum {
  id: number;
  title: string;
  link?: string;
  cover_xl?: string;
  cover_big?: string;
  release_date?: string;
  record_type?: string;
}

/** Deezer önizleme linkleri ~15 dk geçerli; profil önbelleği bundan kısa tutulur. */
const CACHE_TTL_MS = 10 * 60_000;

const summary = (a: DeezerArtist): ArtistSummary => ({
  id: String(a.id),
  name: a.name,
  // Deezer, resmi olmayan sanatçılarda boş gri görsel döndürür ("/artist//")
  pictureUrl: a.picture_xl && !a.picture_xl.includes('/artist//') ? a.picture_xl : null,
  fans: a.nb_fan ?? null,
});

const RECORD_TYPE: Record<string, ArtistAlbum['type']> = {
  album: 'album',
  single: 'single',
  ep: 'ep',
  compile: 'compilation',
};

export class ArtistService {
  private readonly cache = new Map<string, { value: ArtistProfile; expiresAt: number }>();
  private readonly base = env.DEEZER_API_BASE_URL;

  /** Ada göre en iyi eşleşen sanatçı (tıklanan sanatçı adı → profil). Bulunamazsa null. */
  async find(name: string): Promise<ArtistSummary | null> {
    const data = await this.get<{ data?: DeezerArtist[] }>('/search/artist', { q: name, limit: 10 });
    const ranked = (data.data ?? [])
      .map((a, i) => ({ a, score: artistSimilarity(name, a.name) - i * 0.01 + Math.min(0.05, Math.log10((a.nb_fan ?? 0) + 1) / 100) }))
      .filter((x) => artistSimilarity(name, x.a.name) >= 0.8)
      .sort((x, y) => y.score - x.score);
    return ranked[0] ? summary(ranked[0].a) : null;
  }

  async profile(id: string): Promise<ArtistProfile> {
    if (!/^\d+$/.test(id)) throw new MetadataError('INVALID_URL', 'Geçersiz sanatçı kimliği');
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const [artist, top, albums, related] = await Promise.all([
      this.get<DeezerArtist & { error?: unknown }>(`/artist/${id}`),
      this.get<{ data?: DeezerTopTrack[] }>(`/artist/${id}/top`, { limit: 50 }),
      this.get<{ data?: DeezerArtistAlbum[] }>(`/artist/${id}/albums`, { limit: 100 }),
      this.get<{ data?: DeezerArtist[] }>(`/artist/${id}/related`, { limit: 12 }).catch(() => ({ data: [] })),
    ]);
    if (!artist?.id || artist.error) throw new MetadataError('NOT_FOUND', 'Sanatçı bulunamadı', { platform: 'deezer' });

    const seen = new Set<string>();
    const profile: ArtistProfile = {
      artist: { ...summary(artist), albumCount: artist.nb_album ?? null },
      topTracks: (top.data ?? []).map((t) => {
        const main = t.contributors?.filter((c) => c.role === 'Main').map((c) => c.name) ?? [];
        return {
          id: String(t.id),
          title: t.title,
          artist: main.length ? main.join(', ') : t.artist.name,
          album: t.album?.title ?? null,
          coverUrl: t.album?.cover_xl ?? t.album?.cover_big ?? null,
          duration: t.duration ?? null,
          previewUrl: stableDeezerPreview(t.id, t.preview),
          url: t.link ?? `https://www.deezer.com/track/${t.id}`,
        };
      }),
      albums: (albums.data ?? [])
        // Aynı adlı tekrarlar (farklı bölge sürümleri) bir kez gösterilir
        .filter((a) => {
          const key = `${a.title.toLowerCase()}|${a.record_type}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((a) => ({
          id: String(a.id),
          title: a.title,
          coverUrl: a.cover_xl ?? a.cover_big ?? null,
          releaseYear: toYear(a.release_date),
          type: RECORD_TYPE[a.record_type ?? 'album'] ?? 'album',
          url: a.link ?? `https://www.deezer.com/album/${a.id}`,
        }))
        .sort((x, y) => (y.releaseYear ?? '').localeCompare(x.releaseYear ?? '')),
      related: (related.data ?? []).map(summary),
    };

    if (this.cache.size > 100) this.cache.clear();
    this.cache.set(id, { value: profile, expiresAt: Date.now() + CACHE_TTL_MS });
    return profile;
  }

  private async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    try {
      const { data } = await http.get<T>(`${this.base}${path}`, { params });
      return data;
    } catch (err) {
      throw toProviderError(err, 'deezer', 'Deezer sanatçı');
    }
  }
}

export const artistService = new ArtistService();
