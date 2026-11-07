import axios, { type AxiosInstance } from 'axios';
import { stripTitleNoise } from '../matcher/similarity.js';
import { LyricsNotFoundError, LyricsProviderError } from './errors.js';
import { isSyncedLrc } from './lrc.js';
import type { Lyrics, LrcLibRecord, LyricsQuery } from './types.js';

/** LRCLib, istemcinin kendini tanıtmasını ister (https://lrclib.net/docs). */
const USER_AGENT = 'FlacSync (https://github.com/furkibayashi/flacsync)';
const DURATION_TOLERANCE_SEC = 3;

function isRecord(value: unknown): value is LrcLibRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'number' && typeof v.trackName === 'string' && typeof v.artistName === 'string';
}

const normalize = (s: string) =>
  s
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function toLyrics(record: LrcLibRecord): Lyrics {
  return {
    source: 'lrclib',
    synced: isSyncedLrc(record.syncedLyrics) ? record.syncedLyrics.trim() : null,
    plain: record.plainLyrics?.trim() || null,
    instrumental: record.instrumental,
    match: {
      title: record.trackName,
      artist: record.artistName,
      album: record.albumName,
      duration: record.duration,
    },
  };
}

/**
 * LRCLib istemcisi. Önce birebir eşleşme (/api/get: ad + sanatçı + albüm + süre),
 * bulunamazsa arama (/api/search) yapılır ve süresi tutan, zaman damgalı kayıt tercih edilir.
 */
export class LrcLibClient {
  private readonly http: AxiosInstance;

  constructor(baseUrl = 'https://lrclib.net', timeoutMs = 8000) {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: timeoutMs,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  }

  /** Eşleşen sözleri döndürür; yoksa `LyricsNotFoundError`, ağ hatasında `LyricsProviderError`. */
  async find(query: LyricsQuery, signal?: AbortSignal): Promise<Lyrics> {
    const title = stripTitleNoise(query.title);
    const exact = query.duration ? await this.getExact({ ...query, title }, signal) : null;
    if (exact && (exact.syncedLyrics || exact.plainLyrics || exact.instrumental)) return toLyrics(exact);

    const found = await this.searchBest({ ...query, title }, signal);
    if (!found) throw new LyricsNotFoundError(`LRCLib: "${query.artist} - ${query.title}" için söz bulunamadı`);
    return toLyrics(found);
  }

  private async getExact(query: LyricsQuery, signal?: AbortSignal): Promise<LrcLibRecord | null> {
    const params: Record<string, string | number> = {
      track_name: query.title,
      artist_name: query.artist,
      duration: Math.round(query.duration ?? 0),
    };
    if (query.album) params.album_name = query.album;
    const data = await this.request('/api/get', params, signal);
    return isRecord(data) ? data : null;
  }

  private async searchBest(query: LyricsQuery, signal?: AbortSignal): Promise<LrcLibRecord | null> {
    const data = await this.request('/api/search', { track_name: query.title, artist_name: query.artist }, signal);
    if (!Array.isArray(data)) return null;
    const wantTitle = normalize(query.title);
    const wantArtist = normalize(query.artist.split(/,|&| feat\.? /i)[0] ?? query.artist);

    const candidates = data.filter(isRecord).filter((r) => {
      const titleOk = normalize(r.trackName).includes(wantTitle) || wantTitle.includes(normalize(r.trackName));
      const artistOk = normalize(r.artistName).includes(wantArtist) || wantArtist.includes(normalize(r.artistName));
      const durationOk =
        !query.duration || r.duration === null || Math.abs(r.duration - query.duration) <= DURATION_TOLERANCE_SEC;
      return titleOk && artistOk && durationOk && (r.syncedLyrics || r.plainLyrics || r.instrumental);
    });
    // Zaman damgalı olanlar önce, sonra süresi en yakın olan
    candidates.sort((a, b) => {
      const synced = Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics));
      if (synced !== 0) return synced;
      const da = query.duration && a.duration ? Math.abs(a.duration - query.duration) : 0;
      const db = query.duration && b.duration ? Math.abs(b.duration - query.duration) : 0;
      return da - db;
    });
    return candidates[0] ?? null;
  }

  /** 404 → null; diğer hatalar → LyricsProviderError */
  private async request(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
    try {
      const { data } = await this.http.get<unknown>(path, { params, signal });
      return data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? null;
        if (status === 404) return null;
        const timeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
        throw new LyricsProviderError(`LRCLib isteği başarısız (${status ? `HTTP ${status}` : err.code ?? err.message})`, status, {
          cause: err,
          timeout,
        });
      }
      throw new LyricsProviderError(`LRCLib isteği başarısız: ${(err as Error).message}`, null, { cause: err });
    }
  }
}
