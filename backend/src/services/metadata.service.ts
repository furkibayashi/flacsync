import { logger } from '../utils/logger.js';
import { MetadataError } from './metadata/errors.js';
import { finalizeMetadata, hasMissingFields, mergeMetadata } from './metadata/normalize.js';
import { AppleMusicProvider } from './metadata/providers/apple-music.provider.js';
import { DeezerProvider } from './metadata/providers/deezer.provider.js';
import { SpotifyProvider } from './metadata/providers/spotify.provider.js';
import { YouTubeMusicProvider } from './metadata/providers/youtube-music.provider.js';
import type {
  Collection,
  ExtractionResult,
  MetadataProvider,
  ParsedMusicUrl,
  Platform,
  TrackMetadata,
} from './metadata/types.js';
import { AmazonMusicResolver, isAmazonMusicUrl } from './metadata/amazon.js';
import { detectPlatform, parseMusicUrl } from './metadata/url-parser.js';
import { searchService } from './search.service.js';

export { MetadataError } from './metadata/errors.js';
export type { Collection, CollectionTrack, ExtractionResult, Platform, TrackMetadata } from './metadata/types.js';

export type LookupResult = ({ kind: 'track' } & ExtractionResult) | { kind: 'collection'; collection: Collection };

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;

/**
 * Metadata Extractor
 *
 * 1. URL'nin platformunu tespit eder (kısa linkleri açar).
 * 2. İlgili sağlayıcıdan şarkı bilgisini çeker.
 * 3. Eksik alanları (ISRC, albüm, yıl, kapak) Deezer'dan tamamlar:
 *    ISRC varsa birebir ISRC araması, yoksa başlık + sanatçı + süre eşleştirmesi.
 * 4. Sonucu standart `TrackMetadata` formatına normalize eder.
 */
export class MetadataService {
  private readonly providers: Record<Platform, MetadataProvider>;
  private readonly cache = new Map<string, { value: ExtractionResult; expiresAt: number }>();
  private readonly collectionCache = new Map<string, { value: Collection; expiresAt: number }>();

  constructor(
    private readonly deezer = new DeezerProvider(),
    overrides: Partial<Record<Platform, MetadataProvider>> = {},
  ) {
    this.providers = {
      spotify: new SpotifyProvider(),
      'apple-music': new AppleMusicProvider(),
      deezer: this.deezer,
      'youtube-music': new YouTubeMusicProvider(),
      ...overrides,
    };
  }

  /** Ağ isteği yapmadan platform tespiti (frontend'de anlık doğrulama için). */
  detectPlatform(url: string): Platform | null {
    return detectPlatform(url);
  }

  /** Desteklenen bir müzik linki mi (Amazon Music dahil)? */
  isSupportedUrl(url: string): boolean {
    return Boolean(detectPlatform(url)) || isAmazonMusicUrl(url);
  }

  private readonly amazon = new AmazonMusicResolver((artist, album) => searchService.findAlbum(artist, album));

  /** Amazon Music linkini eşdeğer Deezer / Apple / Spotify linkine çevirir; diğerlerini olduğu gibi bırakır. */
  private async translate(url: string): Promise<string> {
    return isAmazonMusicUrl(url) ? this.amazon.resolve(url) : url;
  }

  /** Verilen URL için standart metadata JSON'unu döndürür. */
  async extract(url: string): Promise<TrackMetadata> {
    return (await this.extractDetailed(url)).metadata;
  }

  /**
   * Link türüne göre: tek şarkıysa metadata, albüm / çalma listesiyse parça listesi.
   * Arayüz link girişlerinde bunu kullanır.
   */
  async lookup(url: string): Promise<LookupResult> {
    const parsed = await parseMusicUrl(await this.translate(url));
    if (parsed.type === 'track') return { kind: 'track', ...(await this.extractDetailed(parsed.url)) };
    if (parsed.type === 'album' || parsed.type === 'playlist') {
      return { kind: 'collection', collection: await this.getCollection(parsed) };
    }
    throw new MetadataError(
      'UNSUPPORTED_RESOURCE',
      `Sanatçı sayfaları desteklenmiyor; şarkı, albüm ya da çalma listesi linki girin.`,
      { platform: parsed.platform },
    );
  }

  private async getCollection(parsed: ParsedMusicUrl): Promise<Collection> {
    const key = `collection:${parsed.platform}:${parsed.type}:${parsed.id}`;
    const cached = this.collectionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const provider = this.providers[parsed.platform];
    if (!provider.getCollection) {
      throw new MetadataError('UNSUPPORTED_RESOURCE', `${parsed.platform} albüm/çalma listesi desteklenmiyor`, {
        platform: parsed.platform,
      });
    }
    const collection = await provider.getCollection(parsed);
    // Albüm sanatçısı gelmediyse (ör. YouTube Music) parçalarda en sık geçen sanatçı
    if (!collection.artist && collection.type === 'album') {
      const counts = new Map<string, number>();
      for (const t of collection.tracks) if (t.artist) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
      collection.artist = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    if (collection.tracks.length === 0) {
      throw new MetadataError('NOT_FOUND', 'Albüm / çalma listesinde indirilebilir parça yok', { platform: parsed.platform });
    }
    if (this.collectionCache.size >= 100) {
      const oldest = this.collectionCache.keys().next().value;
      if (oldest !== undefined) this.collectionCache.delete(oldest);
    }
    this.collectionCache.set(key, { value: collection, expiresAt: Date.now() + CACHE_TTL_MS });
    return collection;
  }

  /** Metadata + kaynak platform / kimlik / zenginleştirme bilgisi. */
  async extractDetailed(url: string): Promise<ExtractionResult> {
    const parsed = await parseMusicUrl(await this.translate(url));

    if (parsed.type !== 'track') {
      throw new MetadataError(
        'UNSUPPORTED_RESOURCE',
        `Şu an yalnızca tekil şarkı linkleri destekleniyor (gelen: ${parsed.type}).`,
        { platform: parsed.platform },
      );
    }

    const cacheKey = `${parsed.platform}:${parsed.id}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const primary = await this.providers[parsed.platform].getTrack(parsed);
    const { metadata, enrichedFrom } = await this.enrich(primary, parsed);

    const result: ExtractionResult = {
      platform: parsed.platform,
      sourceId: parsed.id,
      sourceUrl: parsed.url,
      metadata: finalizeMetadata(metadata),
      enrichedFrom,
    };
    this.remember(cacheKey, result);
    return result;
  }

  private async enrich(
    primary: TrackMetadata,
    parsed: ParsedMusicUrl,
  ): Promise<{ metadata: TrackMetadata; enrichedFrom: Platform[] }> {
    // YouTube thumbnail'ları genelde video karesidir → Deezer kapağını tercih et
    const preferSecondaryCover = parsed.platform === 'youtube-music';
    const needsEnrichment = hasMissingFields(primary) || preferSecondaryCover;

    if (parsed.platform === 'deezer' || !needsEnrichment) {
      return { metadata: primary, enrichedFrom: [] };
    }

    try {
      const match = primary.isrc
        ? await this.deezer.getByIsrc(primary.isrc)
        : await this.deezer.findBestMatch({
            title: primary.title,
            artist: primary.artist,
            duration: primary.duration,
            year: primary.releaseDate,
          });

      if (match) {
        return {
          metadata: mergeMetadata(primary, match, { preferSecondaryCover }),
          enrichedFrom: ['deezer'],
        };
      }
      logger.debug({ title: primary.title, artist: primary.artist }, 'Deezer’da eşleşme bulunamadı');
    } catch (err) {
      // Zenginleştirme opsiyoneldir; birincil veri yine döner
      logger.warn({ err, title: primary.title }, 'Deezer zenginleştirmesi başarısız');
    }
    return { metadata: primary, enrichedFrom: [] };
  }

  private remember(key: string, value: ExtractionResult): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

export const metadataService = new MetadataService();
