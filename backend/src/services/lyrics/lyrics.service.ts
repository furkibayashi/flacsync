import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { isLyricsError, LyricsError } from './errors.js';
import { LrcLibClient } from './lrclib.client.js';
import { embedLyricsInFile, formatOf, readEmbeddedLyrics } from './tagger.js';
import type { EmbedResult, Lyrics, LyricsQuery } from './types.js';

const CACHE_TTL_MS = 6 * 60 * 60_000;
const NEGATIVE_TTL_MS = 30 * 60_000;
const MAX_CACHE = 500;
const PROVIDER_COOLDOWN_MS = 5 * 60_000;

const cacheKey = (q: LyricsQuery) =>
  `${q.artist}|${q.title}|${q.album ?? ''}|${q.duration ? Math.round(q.duration) : ''}`.toLowerCase();

function toFailure(err: unknown): Extract<EmbedResult, { status: 'failed' }> {
  if (isLyricsError(err)) return { status: 'failed', code: err.code, message: err.message };
  return { status: 'failed', code: 'LYRICS_PROVIDER_ERROR', message: err instanceof Error ? err.message : String(err) };
}

/**
 * Şarkı sözü servisi: LRCLib'den zaman damgalı sözleri bulur, FLAC / MP3'e gömer.
 *
 * Söz bulunamaması ya da etiket yazılamaması indirmeyi asla bozmaz: genel metodlar
 * hata fırlatmaz, `null` veya `EmbedResult` döndürür ve durumu loglar.
 */
export class LyricsService {
  private readonly cache = new Map<string, { value: Lyrics | null; expiresAt: number }>();
  /** Sağlayıcıya ulaşılamazsa bir süre denenmez: her indirme zaman aşımını beklemesin */
  private unavailableUntil = 0;

  constructor(
    private readonly client = new LrcLibClient(env.LRCLIB_BASE_URL),
    private readonly enabled = env.LYRICS_ENABLED,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sözleri arar. Bulunamazsa ya da sağlayıcıya ulaşılamazsa `null` (hata fırlatmaz).
   * `throwOnError` yalnızca testler ve API'nin ayrıntılı hata göstermesi için.
   */
  async find(query: LyricsQuery, options: { signal?: AbortSignal; throwOnError?: boolean } = {}): Promise<Lyrics | null> {
    const key = cacheKey(query);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    if (!options.throwOnError && Date.now() < this.unavailableUntil) return null;

    try {
      const lyrics = await this.client.find(query, options.signal);
      this.remember(key, lyrics, CACHE_TTL_MS);
      return lyrics;
    } catch (err) {
      if (isLyricsError(err) && err.isNotFound) {
        this.remember(key, null, NEGATIVE_TTL_MS);
        logger.debug({ artist: query.artist, title: query.title }, 'Şarkı sözü bulunamadı');
      } else if (!options.signal?.aborted) {
        this.unavailableUntil = Date.now() + PROVIDER_COOLDOWN_MS;
        logger.warn({ err, artist: query.artist, title: query.title }, 'Şarkı sözü sağlayıcısına ulaşılamadı');
      }
      if (options.throwOnError) throw err;
      return null;
    }
  }

  /** Sözleri bulup var olan dosyaya gömer. Sonucu döndürür, hata fırlatmaz. */
  async fetchAndEmbed(file: string, query: LyricsQuery, options: { force?: boolean } = {}): Promise<EmbedResult> {
    if (!this.enabled && !options.force) return { status: 'skipped', reason: 'disabled' };
    if (!formatOf(file)) return { status: 'skipped', reason: 'unsupported-format' };

    let lyrics: Lyrics | null;
    try {
      lyrics = await this.find(query, { throwOnError: true });
    } catch (err) {
      return isLyricsError(err) && err.isNotFound ? { status: 'not-found' } : toFailure(err);
    }
    if (!lyrics) return { status: 'not-found' };
    if (lyrics.instrumental && !lyrics.synced && !lyrics.plain) return { status: 'skipped', reason: 'instrumental' };

    try {
      await embedLyricsInFile(file, lyrics);
      logger.info({ file, synced: Boolean(lyrics.synced) }, 'Şarkı sözü dosyaya gömüldü');
      return { status: 'embedded', synced: Boolean(lyrics.synced), source: lyrics.source };
    } catch (err) {
      logger.warn({ err, file }, 'Şarkı sözü dosyaya yazılamadı');
      return toFailure(err instanceof LyricsError ? err : new LyricsError('TAG_WRITE_FAILED', String(err), { cause: err }));
    }
  }

  /** Oynatıcı için: önce dosyadaki sözler, yoksa LRCLib. */
  async forFile(file: string, query: LyricsQuery): Promise<Lyrics | null> {
    const embedded = await readEmbeddedLyrics(file).catch(() => null);
    if (embedded) return embedded;
    return this.find(query);
  }

  private remember(key: string, value: Lyrics | null, ttl: number): void {
    if (this.cache.size >= MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttl });
  }
}

export const lyricsService = new LyricsService();
