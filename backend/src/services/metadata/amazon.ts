import axios from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { MetadataError } from './errors.js';

/**
 * Amazon Music linkleri.
 *
 * Amazon'un herkese açık bir müzik API'si yok ve sayfaları tarayıcıda JavaScript ile çizildiği
 * için sunucudan okunamıyor. Bu yüzden Amazon linki, aynı kaydın Deezer / Apple Music / Spotify
 * linkine çevrilir ve uygulamanın normal akışı (metadata, önizleme, indirme) o link üzerinden çalışır:
 *
 *  1. ODESLI_API_KEY tanımlıysa: song.link (Odesli) — şarkı ve albüm linkleri.
 *  2. Anahtar yoksa, albüm linkleri: MusicBrainz'de ASIN araması → albüm adı + sanatçı →
 *     Deezer'da aynı albüm. (Şarkı linkinde "trackAsin" varsa albümü açılır.)
 */

export interface AmazonLink {
  kind: 'track' | 'album' | 'playlist' | 'artist' | 'unknown';
  /** Albüm / şarkı ASIN'i (B0…) */
  asin: string | null;
  /** albums/{ALBUM}?trackAsin={TRACK} linklerinde şarkının ASIN'i */
  trackAsin: string | null;
  url: string;
}

const ASIN = /^[A-Z0-9]{10}$/;
const AMAZON_HOST = /^(?:www\.|music\.|m\.)?amazon\.(?:com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br|com\.mx|com\.tr|nl|se|pl)$/i;

export function isAmazonMusicUrl(input: string): boolean {
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    if (!AMAZON_HOST.test(url.hostname)) return false;
    // music.amazon.* her zaman; amazon.com yalnızca müzik yollarında
    return url.hostname.toLowerCase().includes('music.') || /\/(music|dp|gp\/product)\//i.test(url.pathname);
  } catch {
    return false;
  }
}

export function parseAmazonUrl(input: string): AmazonLink {
  const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  const segs = url.pathname.split('/').filter(Boolean);
  // /music/player/albums/… biçimi
  const start = segs[0] === 'music' && segs[1] === 'player' ? 2 : 0;
  const [type, id] = [segs[start], segs[start + 1]];
  const trackAsin = url.searchParams.get('trackAsin');
  const asin = id && ASIN.test(id) ? id : null;
  const base = { url: url.toString(), trackAsin: trackAsin && ASIN.test(trackAsin) ? trackAsin : null };

  switch (type) {
    case 'albums':
      return { ...base, kind: base.trackAsin ? 'track' : 'album', asin };
    case 'tracks':
      return { ...base, kind: 'track', asin };
    case 'playlists':
    case 'user-playlists':
      return { ...base, kind: 'playlist', asin: id ?? null };
    case 'artists':
      return { ...base, kind: 'artist', asin };
    case 'dp':
    case 'gp': {
      // amazon.com/dp/B0…  |  amazon.com/gp/product/B0… (dijital albüm sayfası)
      const candidate = type === 'dp' ? segs[start + 1] : segs[start + 2];
      return { ...base, kind: 'album', asin: candidate && ASIN.test(candidate) ? candidate : null };
    }
    default:
      return { ...base, kind: 'unknown', asin: null };
  }
}

interface OdesliResponse {
  linksByPlatform?: Partial<Record<'deezer' | 'appleMusic' | 'spotify' | 'youtubeMusic', { url: string }>>;
}

interface MusicBrainzRelease {
  title: string;
  'artist-credit'?: { name: string; joinphrase?: string }[];
}

export type FindAlbum = (artist: string, album: string) => Promise<{ url: string } | null>;

const unresolved = (message: string) => new MetadataError('NOT_FOUND', message);

export class AmazonMusicResolver {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly findAlbum: FindAlbum,
    private readonly odesliKey = env.ODESLI_API_KEY,
    private readonly userAgent = env.MUSICBRAINZ_USER_AGENT ?? 'FlacSync/1.3 ( https://github.com/furkibayashi/flacsync )',
  ) {}

  /** Amazon linkini eşdeğer Deezer / Apple Music / Spotify linkine çevirir. */
  async resolve(input: string): Promise<string> {
    const link = parseAmazonUrl(input);
    const key = `${link.kind}:${link.asin}:${link.trackAsin}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    if (link.kind === 'playlist' || link.kind === 'artist' || link.kind === 'unknown') {
      throw new MetadataError(
        'UNSUPPORTED_RESOURCE',
        'Amazon Music çalma listesi ve sanatçı linkleri desteklenmiyor; şarkı ya da albüm linki girin.',
      );
    }
    if (!link.asin) throw new MetadataError('INVALID_URL', `Amazon Music linki tanınamadı: ${input}`);

    let target: string | null = null;
    if (this.odesliKey) target = await this.viaOdesli(link).catch((err: unknown) => {
      logger.warn({ err }, 'Odesli ile Amazon linki çözülemedi');
      return null;
    });
    if (!target && link.asin) {
      if (link.kind === 'track' && !link.trackAsin) {
        throw new MetadataError(
          'AMAZON_TRACK_NEEDS_KEY',
          'Amazon Music şarkı linkleri için Odesli API anahtarı gerekiyor (Ayarlar → ODESLI_API_KEY). ' +
            'Albüm linki ya da aynı şarkının Spotify / Apple Music / Deezer linkini deneyin.',
        );
      }
      // trackAsin'li albüm linki: şarkı belirlenemez → albüm açılır
      target = await this.viaMusicBrainz(link.asin);
    }
    if (!target) throw unresolved('Bu Amazon Music kaydı diğer platformlarda bulunamadı.');

    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, target);
    return target;
  }

  private async viaOdesli(link: AmazonLink): Promise<string | null> {
    const { data } = await axios.get<OdesliResponse>('https://api.song.link/v1-alpha.1/links', {
      params: { url: link.url, key: this.odesliKey, userCountry: env.APPLE_MUSIC_STOREFRONT.toUpperCase() },
      timeout: 10_000,
    });
    const p = data.linksByPlatform ?? {};
    return p.deezer?.url ?? p.appleMusic?.url ?? p.spotify?.url ?? null;
  }

  private async viaMusicBrainz(asin: string): Promise<string | null> {
    const { data } = await axios.get<{ releases?: MusicBrainzRelease[] }>('https://musicbrainz.org/ws/2/release', {
      params: { query: `asin:${asin}`, fmt: 'json', limit: 1 },
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      timeout: 10_000,
    });
    const release = data.releases?.[0];
    if (!release) return null;
    const artist = (release['artist-credit'] ?? []).map((a) => a.name + (a.joinphrase ?? '')).join('').trim();
    if (!artist) return null;
    return (await this.findAlbum(artist, release.title))?.url ?? null;
  }
}
