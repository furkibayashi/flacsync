import { MetadataError } from './errors.js';
import { http } from './http.js';
import type { ParsedMusicUrl, Platform, ResourceType } from './types.js';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const NUMERIC_ID = /^\d+$/;
const RESOURCE_TYPES: ReadonlySet<string> = new Set(['track', 'album', 'playlist', 'artist']);

/** Yalnızca bu hostlardaki kısa linkler için ağ isteği yapılır (SSRF koruması). */
const SHORT_LINK_HOSTS: Record<string, Platform> = {
  'spotify.link': 'spotify',
  'spotify.app.link': 'spotify',
  'deezer.page.link': 'deezer',
  'link.deezer.com': 'deezer',
};

const HOST_PLATFORM: Record<string, Platform> = {
  'open.spotify.com': 'spotify',
  'play.spotify.com': 'spotify',
  'music.apple.com': 'apple-music',
  'geo.music.apple.com': 'apple-music',
  'embed.music.apple.com': 'apple-music',
  'itunes.apple.com': 'apple-music',
  'deezer.com': 'deezer',
  'music.youtube.com': 'youtube-music',
  'youtube.com': 'youtube-music',
  'youtu.be': 'youtube-music',
};

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(?:www|m)\./, '');
}

function toUrl(input: string): URL {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new MetadataError('INVALID_URL', `Geçersiz URL: ${input}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MetadataError('INVALID_URL', `Desteklenmeyen protokol: ${url.protocol}`);
  }
  return url;
}

function segments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

/** URL'nin hangi platforma ait olduğunu ağ isteği yapmadan tespit eder. */
export function detectPlatform(input: string): Platform | null {
  const trimmed = input.trim();
  if (/^spotify:/i.test(trimmed)) return 'spotify';
  try {
    const host = normalizeHost(toUrl(trimmed).hostname);
    return HOST_PLATFORM[host] ?? SHORT_LINK_HOSTS[host] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Platforma özel ayrıştırıcılar
// ---------------------------------------------------------------------------

function parseSpotify(url: URL): ParsedMusicUrl | null {
  // /track/{id}, /intl-tr/track/{id}, /embed/track/{id}
  const segs = segments(url).filter((s) => !/^intl-[a-z-]+$/i.test(s) && s !== 'embed');
  const [type, id] = segs;
  if (!type || !id || !RESOURCE_TYPES.has(type) || !SPOTIFY_ID.test(id)) return null;
  return { platform: 'spotify', type: type as ResourceType, id, url: url.toString() };
}

function parseAppleMusic(url: URL): ParsedMusicUrl | null {
  // /tr/album/{slug}/{albumId}?i={trackId}
  // /tr/song/{slug}/{songId}  |  /tr/song/{songId}
  // /tr/playlist/{slug}/pl.xxxx  |  /tr/artist/{slug}/{artistId}
  const segs = segments(url);
  let storefront: string | undefined;
  if (segs[0] && /^[a-z]{2}$/i.test(segs[0])) storefront = segs.shift()!.toLowerCase();

  const kind = segs[0];
  const last = segs[segs.length - 1] ?? '';
  // itunes.apple.com eski linklerinde son segment "id123456" biçimindedir
  const lastId = last.replace(/^id/, '');
  const base = { platform: 'apple-music' as const, storefront, url: url.toString() };

  switch (kind) {
    case 'song':
      return NUMERIC_ID.test(lastId) ? { ...base, type: 'track', id: lastId } : null;
    case 'album': {
      const trackId = url.searchParams.get('i');
      if (trackId && NUMERIC_ID.test(trackId)) return { ...base, type: 'track', id: trackId };
      return NUMERIC_ID.test(lastId) ? { ...base, type: 'album', id: lastId } : null;
    }
    case 'playlist':
      return last.startsWith('pl.') ? { ...base, type: 'playlist', id: last } : null;
    case 'artist':
      return NUMERIC_ID.test(lastId) ? { ...base, type: 'artist', id: lastId } : null;
    default:
      return null;
  }
}

function parseDeezer(url: URL): ParsedMusicUrl | null {
  // /track/{id}  |  /tr/track/{id}  |  /en/album/{id}
  const segs = segments(url);
  const idx = segs.findIndex((s) => RESOURCE_TYPES.has(s));
  const type = segs[idx];
  const id = segs[idx + 1];
  if (idx === -1 || !type || !id || !NUMERIC_ID.test(id)) return null;
  return { platform: 'deezer', type: type as ResourceType, id, url: url.toString() };
}

function parseYouTube(url: URL, host: string): ParsedMusicUrl | null {
  const segs = segments(url);
  const base = { platform: 'youtube-music' as const, url: url.toString() };

  if (host === 'youtu.be') {
    const id = segs[0];
    return id && YOUTUBE_ID.test(id) ? { ...base, type: 'track', id } : null;
  }

  const v = url.searchParams.get('v');
  if (segs[0] === 'watch' && v && YOUTUBE_ID.test(v)) return { ...base, type: 'track', id: v };
  if ((segs[0] === 'shorts' || segs[0] === 'embed') && segs[1] && YOUTUBE_ID.test(segs[1])) {
    return { ...base, type: 'track', id: segs[1] };
  }

  const list = url.searchParams.get('list');
  if (segs[0] === 'playlist' && list) {
    // YouTube Music'te albümler "OLAK5uy_" önekli playlist'lerdir
    return { ...base, type: list.startsWith('OLAK5uy_') ? 'album' : 'playlist', id: list };
  }
  if (segs[0] === 'browse' && segs[1]?.startsWith('MPREb')) return { ...base, type: 'album', id: segs[1] };
  if (segs[0] === 'channel' && segs[1]) return { ...base, type: 'artist', id: segs[1] };
  return null;
}

function parseKnownUrl(url: URL): ParsedMusicUrl | null {
  const host = normalizeHost(url.hostname);
  switch (HOST_PLATFORM[host]) {
    case 'spotify':
      return parseSpotify(url);
    case 'apple-music':
      return parseAppleMusic(url);
    case 'deezer':
      return parseDeezer(url);
    case 'youtube-music':
      return parseYouTube(url, host);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Kısa link açma
// ---------------------------------------------------------------------------

const EMBEDDED_LINK =
  /https?:\/\/(?:open\.spotify\.com|(?:www\.)?deezer\.com)\/[^\s"'<>\\]+/i;

async function expandShortLink(url: URL, platform: Platform): Promise<URL> {
  let finalUrl: string | undefined;
  let body = '';
  try {
    const res = await http.get<string>(url.toString(), {
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: (s) => s < 400,
    });
    finalUrl = (res.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl;
    body = typeof res.data === 'string' ? res.data : '';
  } catch (err) {
    throw new MetadataError('PROVIDER_ERROR', `Kısa link açılamadı: ${url}`, { platform, cause: err });
  }

  if (finalUrl) {
    const resolved = new URL(finalUrl);
    if (HOST_PLATFORM[normalizeHost(resolved.hostname)]) return resolved;
  }
  // Bazı kısa link servisleri JS/meta yönlendirme sayfası döndürür
  const embedded = EMBEDDED_LINK.exec(body)?.[0];
  if (embedded) return new URL(embedded.replace(/&amp;/g, '&'));

  throw new MetadataError('INVALID_URL', `Kısa link bir şarkı sayfasına çözülemedi: ${url}`, { platform });
}

// ---------------------------------------------------------------------------

/**
 * Herhangi bir desteklenen müzik linkini (veya `spotify:track:...` URI'sini)
 * platform + kaynak tipi + kimlik bilgisine ayrıştırır. Kısa linkleri açar.
 */
export async function parseMusicUrl(input: string): Promise<ParsedMusicUrl> {
  const trimmed = input.trim();
  if (!trimmed) throw new MetadataError('INVALID_URL', 'URL boş olamaz');

  const uri = /^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/i.exec(trimmed);
  if (uri?.[1] && uri[2]) {
    const type = uri[1].toLowerCase() as ResourceType;
    return {
      platform: 'spotify',
      type,
      id: uri[2],
      url: `https://open.spotify.com/${type}/${uri[2]}`,
    };
  }

  let url = toUrl(trimmed);
  const shortLinkPlatform = SHORT_LINK_HOSTS[normalizeHost(url.hostname)];
  if (shortLinkPlatform) url = await expandShortLink(url, shortLinkPlatform);

  const host = normalizeHost(url.hostname);
  if (!HOST_PLATFORM[host]) {
    throw new MetadataError(
      'UNSUPPORTED_PLATFORM',
      `Desteklenmeyen platform: ${host}. Spotify, Apple Music, Deezer veya YouTube Music linki girin.`,
    );
  }

  const parsed = parseKnownUrl(url);
  if (!parsed) {
    throw new MetadataError('INVALID_URL', `Link tanınamadı: ${url}`, { platform: HOST_PLATFORM[host] });
  }
  return parsed;
}
