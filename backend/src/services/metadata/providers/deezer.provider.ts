import { env } from '../../../config/env.js';
import {
  scoreTrackMatch,
  splitArtists,
  stripTitleNoise,
  type MatchCandidate,
} from '../../matcher/similarity.js';
import { MetadataError, isNotFound } from '../errors.js';
import { http, toProviderError } from '../http.js';
import { joinArtists, MAX_COLLECTION_TRACKS, toYear } from '../normalize.js';
import type { Collection, MetadataProvider, ParsedMusicUrl, TrackMetadata } from '../types.js';

interface DeezerErrorBody {
  error: { type: string; message: string; code: number };
}

interface DeezerContributor {
  id: number;
  name: string;
  role?: string;
}

interface DeezerTrack {
  id: number;
  title: string;
  isrc?: string;
  /** saniye */
  duration?: number;
  release_date?: string;
  /** Herkese açık 30 sn MP3 önizleme */
  preview?: string;
  artist: { id: number; name: string };
  contributors?: DeezerContributor[];
  album?: { id: number; title: string; cover_xl?: string; cover_big?: string; release_date?: string };
}

interface DeezerSearchResponse {
  data: DeezerTrack[];
  total: number;
}

interface DeezerCollectionInfo {
  title: string;
  link?: string;
  release_date?: string;
  cover_xl?: string;
  picture_xl?: string;
  artist?: { name: string };
  creator?: { name: string };
}

interface DeezerCollectionTrack {
  id: number;
  title: string;
  link?: string;
  duration?: number;
  isrc?: string;
  track_position?: number;
  disk_number?: number;
  artist: { name: string };
}

const DEEZER_NO_DATA = 800;
/** En iyi skora bu kadar yakın adaylar "eşit" sayılır ve yıla göre ayrılır. */
const SCORE_TIE_MARGIN = 0.05;

function isDeezerError(body: unknown): body is DeezerErrorBody {
  return typeof body === 'object' && body !== null && 'error' in body;
}

function toMetadata(track: DeezerTrack): TrackMetadata {
  const mainArtists = track.contributors?.filter((c) => c.role === 'Main').map((c) => c.name) ?? [];
  return {
    title: track.title,
    artist: joinArtists(mainArtists.length > 0 ? mainArtists : [track.artist.name]),
    album: track.album?.title ?? null,
    // track.release_date Deezer'da yeniden yükleme tarihini gösterebiliyor → albüm tarihi öncelikli
    releaseDate: toYear(track.album?.release_date ?? track.release_date),
    coverUrl: track.album?.cover_xl ?? track.album?.cover_big ?? null,
    isrc: track.isrc ?? null,
    duration: track.duration ?? null,
  };
}

/**
 * Deezer public API — anahtar gerektirmez.
 * Hem birincil kaynak hem de diğer platformlar için ISRC / albüm / kapak
 * zenginleştirme kaynağı olarak kullanılır.
 */
export class DeezerProvider implements MetadataProvider {
  readonly platform = 'deezer' as const;

  constructor(private readonly baseUrl: string = env.DEEZER_API_BASE_URL) {}

  async getTrack(parsed: ParsedMusicUrl): Promise<TrackMetadata> {
    return toMetadata(await this.request<DeezerTrack>(`/track/${encodeURIComponent(parsed.id)}`));
  }

  /** ISRC ile birebir arama. Bulunamazsa `null`. */
  async getByIsrc(isrc: string): Promise<TrackMetadata | null> {
    try {
      return toMetadata(await this.request<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** ISRC'ye ait herkese açık 30 sn önizleme URL'si (arayüzde dinletmek için). */
  async getPreviewUrl(isrc: string): Promise<string | null> {
    try {
      const track = await this.request<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`);
      return track.preview || null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Başlık + sanatçı + süre ile arar, skoru eşiği geçen en iyi adayın
   * tam kaydını (ISRC dahil) döndürür.
   *
   * Aynı kayıt hem orijinal albümde hem derlemelerde bulunduğundan, skoru
   * en iyiye yakın adaylar arasında çıkış yılı `target.year` ile tutanı seçer.
   */
  async findBestMatch(target: MatchCandidate & { year?: string | null }): Promise<TrackMetadata | null> {
    const primaryArtist = splitArtists(target.artist)[0] ?? target.artist;
    const title = stripTitleNoise(target.title);
    const q = (s: string) => s.replace(/"/g, '');
    // Not: Deezer'ın `artist:"..."` filtresi şu an her sorguda 0 sonuç dönüyor (Kasım 2026);
    // serbest metin + `track:"..."` kullanılıyor, sanatçı kontrolü skorlamada yapılıyor.
    const queries = [`${primaryArtist} ${title}`, `track:"${q(title)}"`];
    const durationToleranceSec = env.MATCH_DURATION_TOLERANCE_MS / 1000;

    for (const query of queries) {
      const { data } = await this.request<DeezerSearchResponse>('/search', { q: query, limit: 25 });

      const ranked = (data ?? [])
        .map((track) => ({
          track,
          score: scoreTrackMatch(
            target,
            { title: track.title, artist: track.artist.name, duration: track.duration ?? null },
            { durationToleranceSec },
          ),
        }))
        .filter((c) => c.score >= env.MATCH_MIN_SCORE)
        .sort((a, b) => b.score - a.score);

      const top = ranked[0];
      if (!top) continue;

      // Arama sonuçlarında ISRC / çıkış tarihi yok → adayların tam kaydını çek
      const shortlist = ranked
        .filter((c) => top.score - c.score <= SCORE_TIE_MARGIN)
        .slice(0, env.MATCH_MAX_CANDIDATES);

      let first: TrackMetadata | null = null;
      for (const { track } of shortlist) {
        const full = toMetadata(await this.request<DeezerTrack>(`/track/${track.id}`));
        if (!target.year || full.releaseDate === target.year) return full;
        first ??= full;
      }
      return first;
    }
    return null;
  }

  /** Albüm veya çalma listesinin parçaları (ISRC dahil). */
  async getCollection(parsed: ParsedMusicUrl): Promise<Collection> {
    if (parsed.type !== 'album' && parsed.type !== 'playlist') {
      throw new MetadataError('UNSUPPORTED_RESOURCE', `Deezer ${parsed.type} desteklenmiyor`, { platform: 'deezer' });
    }
    const id = encodeURIComponent(parsed.id);
    const info = await this.request<DeezerCollectionInfo>(`/${parsed.type}/${id}`);

    const tracks: DeezerCollectionTrack[] = [];
    let total = Infinity;
    while (tracks.length < Math.min(total, MAX_COLLECTION_TRACKS)) {
      const page = await this.request<{ data?: DeezerCollectionTrack[]; total?: number }>(`/${parsed.type}/${id}/tracks`, {
        index: tracks.length,
        limit: 100,
      });
      const items = page.data ?? [];
      total = page.total ?? items.length;
      if (items.length === 0) break;
      tracks.push(...items);
    }

    const isAlbum = parsed.type === 'album';
    return {
      platform: 'deezer',
      type: parsed.type,
      id: parsed.id,
      url: info.link ?? parsed.url,
      title: info.title,
      artist: isAlbum ? info.artist?.name ?? null : info.creator?.name ?? null,
      coverUrl: info.cover_xl ?? info.picture_xl ?? null,
      releaseYear: toYear(info.release_date),
      totalTracks: Number.isFinite(total) ? total : tracks.length,
      tracks: tracks.slice(0, MAX_COLLECTION_TRACKS).map((t, i) => ({
        position: isAlbum ? t.track_position ?? i + 1 : i + 1,
        disc: isAlbum ? t.disk_number ?? null : null,
        title: t.title,
        artist: t.artist.name,
        duration: t.duration ?? null,
        isrc: t.isrc ?? null,
        url: t.link ?? `https://www.deezer.com/track/${t.id}`,
      })),
    };
  }

  private async request<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    let body: T | DeezerErrorBody;
    try {
      ({ data: body } = await http.get<T | DeezerErrorBody>(`${this.baseUrl}${path}`, { params }));
    } catch (err) {
      throw toProviderError(err, 'deezer', 'Deezer API');
    }
    // Deezer hataları HTTP 200 + { error: {...} } olarak döner
    if (isDeezerError(body)) {
      throw new MetadataError(
        body.error.code === DEEZER_NO_DATA ? 'NOT_FOUND' : 'PROVIDER_ERROR',
        `Deezer API: ${body.error.message} (kod ${body.error.code})`,
        { platform: 'deezer' },
      );
    }
    return body;
  }
}
