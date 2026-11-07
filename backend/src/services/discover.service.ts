import { http } from './metadata/http.js';
import { toYear } from './metadata/normalize.js';

/**
 * Keşfet: ülkeye göre türün en çok dinlenen şarkıları ve albümleri (Apple / iTunes listeleri).
 * Deezer'ın tür listeleri türe göre doğru filtrelemediği için iTunes kullanılır
 * (ör. Deezer "Rock" listesinde pop şarkılar çıkıyordu).
 */

export interface DiscoverGenre {
  /** Apple tür kimliği; 0 = tüm türler */
  id: number;
  key: string;
}

/** Arayüzde çevrilen tür anahtarları ve Apple kimlikleri */
export const GENRES: DiscoverGenre[] = [
  { id: 0, key: 'all' },
  { id: 14, key: 'pop' },
  { id: 21, key: 'rock' },
  { id: 18, key: 'hiphop' },
  { id: 7, key: 'electronic' },
  { id: 17, key: 'dance' },
  { id: 20, key: 'alternative' },
  { id: 15, key: 'rnb' },
  { id: 1153, key: 'metal' },
  { id: 11, key: 'jazz' },
  { id: 5, key: 'classical' },
  { id: 12, key: 'latin' },
  { id: 6, key: 'country' },
  { id: 24, key: 'reggae' },
  { id: 2, key: 'blues' },
  { id: 16, key: 'soundtrack' },
  { id: 10, key: 'singer' },
];

export const COUNTRIES = ['tr', 'us', 'gb', 'de', 'fr', 'es', 'mx', 'jp', 'kr', 'br'] as const;
export type Country = (typeof COUNTRIES)[number];

export interface DiscoverTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  releaseYear: string | null;
  genre: string | null;
  /** İndirme akışına verilecek Apple Music şarkı linki */
  url: string;
  rank: number;
}

export interface DiscoverAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseYear: string | null;
  trackCount: number | null;
  /** Albüm görünümünü açan Apple Music albüm linki */
  url: string;
}

export interface DiscoverResponse {
  genreId: number;
  country: Country;
  tracks: DiscoverTrack[];
  albums: DiscoverAlbum[];
}

interface RssLabel {
  label?: string;
  attributes?: Record<string, string>;
}

interface RssEntry {
  id?: RssLabel;
  'im:name'?: RssLabel;
  'im:artist'?: RssLabel;
  'im:image'?: RssLabel[];
  'im:releaseDate'?: RssLabel;
  'im:itemCount'?: RssLabel;
  'im:collection'?: { 'im:name'?: RssLabel };
  category?: RssLabel;
  link?: RssLabel | RssLabel[];
}

const CACHE_TTL_MS = 30 * 60_000;

/** iTunes listesindeki 170 px kapağı büyük boyuta çevirir */
const bigCover = (url: string | undefined) => url?.replace(/\/\d+x\d+bb\.(png|jpg)$/, '/600x600bb.jpg') ?? null;

function links(entry: RssEntry): RssLabel[] {
  return Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
}

function toTrack(entry: RssEntry, index: number): DiscoverTrack | null {
  const id = entry.id?.attributes?.['im:id'];
  const title = entry['im:name']?.label;
  const artist = entry['im:artist']?.label;
  const page = links(entry).find((l) => l.attributes?.rel === 'alternate')?.attributes?.href;
  if (!id || !title || !artist || !page) return null;
  return {
    id,
    title,
    artist,
    album: entry['im:collection']?.['im:name']?.label ?? null,
    coverUrl: bigCover(entry['im:image']?.at(-1)?.label),
    previewUrl: links(entry).find((l) => l.attributes?.type?.startsWith('audio'))?.attributes?.href ?? null,
    releaseYear: toYear(entry['im:releaseDate']?.label),
    genre: entry.category?.attributes?.label ?? null,
    // ?uo=2 gibi izleme parametreleri atılır; şarkı linki ?i= ile kalır
    url: page.replace(/[?&]uo=\d+/, '').replace(/\?$/, ''),
    rank: index + 1,
  };
}

function toAlbum(entry: RssEntry): DiscoverAlbum | null {
  const id = entry.id?.attributes?.['im:id'];
  const title = entry['im:name']?.label;
  const artist = entry['im:artist']?.label;
  const page = links(entry).find((l) => l.attributes?.rel === 'alternate')?.attributes?.href ?? entry.id?.label;
  if (!id || !title || !artist || !page) return null;
  return {
    id,
    title,
    artist,
    coverUrl: bigCover(entry['im:image']?.at(-1)?.label),
    releaseYear: toYear(entry['im:releaseDate']?.label),
    trackCount: Number(entry['im:itemCount']?.label) || null,
    url: page.replace(/[?&]uo=\d+/, '').replace(/\?$/, ''),
  };
}

export class DiscoverService {
  private readonly cache = new Map<string, { value: DiscoverResponse; expiresAt: number }>();

  async genre(genreId: number, country: Country): Promise<DiscoverResponse> {
    const key = `${country}:${genreId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const genrePart = genreId ? `/genre=${genreId}` : '';
    const [songs, albums] = await Promise.all([
      http.get<{ feed?: { entry?: RssEntry[] | RssEntry } }>(
        `https://itunes.apple.com/${country}/rss/topsongs/limit=50${genrePart}/json`,
      ),
      http
        .get<{ feed?: { entry?: RssEntry[] | RssEntry } }>(
          `https://itunes.apple.com/${country}/rss/topalbums/limit=12${genrePart}/json`,
        )
        .catch(() => ({ data: { feed: { entry: [] as RssEntry[] } } })),
    ]);
    const asArray = (e: RssEntry[] | RssEntry | undefined) => (Array.isArray(e) ? e : e ? [e] : []);

    const value: DiscoverResponse = {
      genreId,
      country,
      tracks: asArray(songs.data.feed?.entry)
        .map(toTrack)
        .filter((t): t is DiscoverTrack => t !== null),
      albums: asArray(albums.data.feed?.entry)
        .map(toAlbum)
        .filter((a): a is DiscoverAlbum => a !== null),
    };
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}

export const discoverService = new DiscoverService();
