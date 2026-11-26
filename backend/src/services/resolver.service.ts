import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { trimInfoForDownload, ytDlpJson, type YtDlpFlatEntry, type YtDlpVideoInfo } from '../utils/ytdlp.js';
import { normalizeText, splitArtists, stripTitleNoise } from './matcher/similarity.js';
import { DeezerProvider } from './metadata/providers/deezer.provider.js';
import { youTubeInfoToMetadata } from './metadata/providers/youtube-music.provider.js';
import type { TrackMetadata } from './metadata/types.js';
import { preScoreEntry, scoreCandidate, type CandidateScore } from './resolver/candidate-scorer.js';
import { selectBestAudioFormat, streamExpiry, toAudioFormat } from './resolver/format-selector.js';
import { ResolverError, type MatchStrategy, type ResolvedSource } from './resolver/types.js';

export { ResolverError } from './resolver/types.js';
export type { AudioFormat, MatchStrategy, ResolvedSource } from './resolver/types.js';

/**
 * Adaylar dalga dalga incelenir: önce en olası ilk ikisi; yeterli eşleşme çıkarsa
 * diğerleri için yt-dlp hiç çalıştırılmaz (her çağrı ~2,5 sn).
 */
const FIRST_WAVE = 2;

/** Arama sonucundaki başlık bu skorun altındaysa tam bilgi sorgusu yapılmaz. */
const PRE_SCORE_MIN = 0.6;
/** Akış URL'si bu kadar süre kala önbellekten düşürülür. */
const STREAM_EXPIRY_MARGIN_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;

interface SearchStep {
  strategy: MatchStrategy;
  url: string;
  limit: number;
}

interface Candidate extends CandidateScore {
  videoId: string;
  strategy: MatchStrategy;
  info: YtDlpVideoInfo;
  metadata: TrackMetadata;
}

export interface RematchCandidate {
  videoId: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  channel: string | null;
  /** 0-1 */
  score: number;
  durationDiff: number | null;
  strategy: MatchStrategy;
  pageUrl: string;
}

const ytMusicSearchUrl = (query: string) =>
  `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`;

/**
 * Audio Resolver
 *
 * Spotify / Apple Music akışları DRM'li olduğundan, standart metadata'yı
 * (ISRC veya sanatçı + başlık + süre) kullanarak YouTube Music'te aynı kaydı
 * bulur ve en kaliteli DRM'siz ses akışını döndürür.
 *
 * Arama planı (ilk geçerli eşleşmede durur):
 *   1. ISRC ile YouTube Music "Songs" araması  → plak şirketi yüklemesini birebir bulur
 *   2. "Sanatçı Şarkı" ile YouTube Music "Songs" araması
 *   3. "Sanatçı Şarkı audio" ile genel YouTube araması (son çare)
 *
 * Her adımda: başlığa göre ön eleme → adayların tam bilgisi (süre, sanatçı,
 * albüm) → skor (başlık + sanatçı + süre ±5 sn, versiyon/cover/live elemesi)
 * → eşiği geçen en yüksek sıralı aday → en iyi ses formatı.
 */
export class ResolverService {
  private readonly cache = new Map<string, { value: ResolvedSource; expiresAt: number }>();

  constructor(private readonly deezer = new DeezerProvider()) {}

  async resolve(meta: TrackMetadata): Promise<ResolvedSource> {
    const key = this.cacheKey(meta);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    // Önizleme, eşleştirme ile paralel çekilir; başarısız olması sonucu etkilemez
    const previewPromise = meta.isrc
      ? this.deezer.getPreviewUrl(meta.isrc).catch(() => null)
      : Promise.resolve(null);

    const best = await this.findBestCandidate(meta);

    const format = selectBestAudioFormat(best.info.formats);
    if (!format?.url) {
      throw new ResolverError('NO_AUDIO_FORMAT', `Eşleşen videoda (${best.videoId}) DRM'siz ses formatı yok`);
    }
    const expiry = streamExpiry(format.url);

    const result: ResolvedSource = {
      provider: 'youtube-music',
      videoId: best.videoId,
      pageUrl: `https://music.youtube.com/watch?v=${best.videoId}`,
      streamUrl: format.url,
      httpHeaders: format.http_headers ?? {},
      expiresAt: expiry?.toISOString() ?? null,
      format: toAudioFormat(format),
      match: {
        strategy: best.strategy,
        score: Math.round(best.score * 1000) / 1000,
        durationDiff: best.durationDiff,
        title: best.metadata.title,
        artist: best.metadata.artist,
        album: best.metadata.album,
      },
      previewUrl: await previewPromise,
      downloadInfo: trimInfoForDownload(best.info),
    };

    this.remember(key, result, expiry);
    logger.info(
      { target: `${meta.artist} - ${meta.title}`, videoId: best.videoId, ...result.match, format: result.format.formatId },
      'Ses kaynağı eşleşti',
    );
    return result;
  }

  /**
   * "Yanlış kayıt" düzeltmesi için en olası adaylar (puanıyla, en iyisi önce). Normal eşleştirmenin
   * aksine ilk uygun adayda durmaz; YouTube Music aramasındaki ilk birkaç sonucun hepsi incelenir.
   */
  async candidates(meta: TrackMetadata, limit = 6): Promise<RematchCandidate[]> {
    const toleranceSec = env.RESOLVER_DURATION_TOLERANCE_MS / 1000;
    const plan = this.buildSearchPlan(meta);
    const seen = new Set<string>();
    const picked: Array<{ id: string; strategy: MatchStrategy; pre: number }> = [];
    for (const step of plan) {
      if (picked.length >= limit) break;
      const res = await ytDlpJson<{ entries?: YtDlpFlatEntry[] }>(step.url, { flatPlaylist: true, playlistEnd: step.limit }).catch(
        () => ({ entries: [] as YtDlpFlatEntry[] }),
      );
      const ranked = (res.entries ?? [])
        .filter((e) => e.id && !seen.has(e.id))
        .map((e) => ({ id: e.id, strategy: step.strategy, pre: step.strategy === 'isrc' ? 1 : preScoreEntry(meta, e.title ?? '') }))
        .filter((c) => c.pre >= 0.3)
        .sort((a, b) => b.pre - a.pre);
      for (const c of ranked) {
        if (picked.length >= limit) break;
        seen.add(c.id);
        picked.push(c);
      }
    }
    const inspected = await Promise.all(picked.map((c) => this.inspect(c.id, meta, c.strategy, toleranceSec)));
    return inspected
      .filter((c): c is Candidate => c !== null)
      .sort((a, b) => b.score - a.score)
      .map((c) => ({
        videoId: c.videoId,
        title: c.metadata.title,
        artist: c.metadata.artist,
        album: c.metadata.album,
        duration: c.metadata.duration,
        channel: c.info.channel ?? c.info.uploader ?? null,
        score: Math.round(c.score * 1000) / 1000,
        durationDiff: c.durationDiff,
        strategy: c.strategy,
        pageUrl: `https://music.youtube.com/watch?v=${c.videoId}`,
      }));
  }

  /** Kullanıcının seçtiği belirli bir videoyu kaynak olarak hazırlar (puanı yine hesaplanır, eşik aranmaz) */
  async fromVideo(videoId: string, meta: TrackMetadata): Promise<ResolvedSource> {
    const candidate = await this.inspect(videoId, meta, 'ytmusic-search', env.RESOLVER_DURATION_TOLERANCE_MS / 1000);
    if (!candidate) throw new ResolverError('NO_MATCH', `Video açılamadı (${videoId}); silinmiş ya da bölgede kapalı olabilir`);
    const format = selectBestAudioFormat(candidate.info.formats);
    if (!format?.url) throw new ResolverError('NO_AUDIO_FORMAT', `Seçilen videoda (${videoId}) DRM'siz ses formatı yok`);
    const expiry = streamExpiry(format.url);
    return {
      provider: 'youtube-music',
      videoId,
      pageUrl: `https://music.youtube.com/watch?v=${videoId}`,
      streamUrl: format.url,
      httpHeaders: format.http_headers ?? {},
      expiresAt: expiry?.toISOString() ?? null,
      format: toAudioFormat(format),
      match: {
        strategy: candidate.strategy,
        score: Math.round(candidate.score * 1000) / 1000,
        durationDiff: candidate.durationDiff,
        title: candidate.metadata.title,
        artist: candidate.metadata.artist,
        album: candidate.metadata.album,
      },
      previewUrl: null,
      downloadInfo: trimInfoForDownload(candidate.info),
    };
  }

  // -------------------------------------------------------------------------

  private buildSearchPlan(meta: TrackMetadata): SearchStep[] {
    const primaryArtist = splitArtists(meta.artist)[0] ?? meta.artist;
    const query = `${primaryArtist} ${stripTitleNoise(meta.title)}`;
    const steps: SearchStep[] = [];

    if (meta.isrc) steps.push({ strategy: 'isrc', url: ytMusicSearchUrl(`"${meta.isrc}"`), limit: 3 });
    steps.push({ strategy: 'ytmusic-search', url: ytMusicSearchUrl(query), limit: 10 });
    steps.push({ strategy: 'youtube-search', url: `ytsearch10:${query} audio`, limit: 10 });
    return steps;
  }

  private async findBestCandidate(meta: TrackMetadata): Promise<Candidate> {
    const toleranceSec = env.RESOLVER_DURATION_TOLERANCE_MS / 1000;
    const tried = new Set<string>();
    let closest: Candidate | null = null;
    let searchFailures = 0;
    const plan = this.buildSearchPlan(meta);

    for (const step of plan) {
      let entries: YtDlpFlatEntry[];
      try {
        const res = await ytDlpJson<{ entries?: YtDlpFlatEntry[] }>(step.url, {
          flatPlaylist: true,
          playlistEnd: step.limit,
        });
        entries = res.entries ?? [];
      } catch (err) {
        searchFailures++;
        logger.warn({ err, strategy: step.strategy }, 'Arama başarısız, sonraki adıma geçiliyor');
        continue;
      }

      // 1) Ucuz ön eleme: başlık benzerliği + (biliniyorsa) süre
      const shortlist = entries
        .filter((e) => e.id && !tried.has(e.id))
        .filter((e) => !(e.duration && meta.duration && Math.abs(e.duration - meta.duration) > toleranceSec))
        .map((e) => ({ id: e.id, pre: step.strategy === 'isrc' ? 1 : preScoreEntry(meta, e.title ?? '') }))
        .filter((c) => c.pre >= PRE_SCORE_MIN)
        .sort((a, b) => b.pre - a.pre)
        .slice(0, env.MATCH_MAX_CANDIDATES);

      shortlist.forEach((c) => tried.add(c.id));

      // 2) Pahalı adım: adayların tam bilgisi, dalgalar halinde (yt-dlp kuyruğu eşzamanlılığı sınırlar)
      const waves = [shortlist.slice(0, FIRST_WAVE), shortlist.slice(FIRST_WAVE)].filter((w) => w.length > 0);
      for (const wave of waves) {
        const scored = (
          await Promise.all(wave.map((c) => this.inspect(c.id, meta, step.strategy, toleranceSec)))
        ).filter((c): c is Candidate => c !== null);

        for (const c of scored) if (!closest || c.score > closest.score) closest = c;

        const winner = scored
          .filter((c) => c.score >= env.RESOLVER_MIN_SCORE)
          .sort((a, b) => b.rank - a.rank)[0];
        if (winner) return winner;
      }
    }

    if (searchFailures === plan.length) {
      throw new ResolverError('PROVIDER_ERROR', 'YouTube Music araması yapılamadı (yt-dlp hataları için logları kontrol edin)');
    }
    const hint = closest
      ? ` En yakın aday: "${closest.metadata.artist} - ${closest.metadata.title}" (skor ${closest.score.toFixed(2)})`
      : '';
    throw new ResolverError('NO_MATCH', `"${meta.artist} - ${meta.title}" için güvenilir eşleşme bulunamadı.${hint}`);
  }

  private async inspect(
    videoId: string,
    target: TrackMetadata,
    strategy: MatchStrategy,
    durationToleranceSec: number,
  ): Promise<Candidate | null> {
    try {
      const info = await ytDlpJson<YtDlpVideoInfo>(`https://music.youtube.com/watch?v=${videoId}`, {
        noPlaylist: true,
        skipDownload: true,
      });
      const metadata = youTubeInfoToMetadata(info);
      const score = scoreCandidate(target, metadata, {
        rawTitle: info.title ?? '',
        channel: info.channel ?? info.uploader ?? null,
        hasOfficialTrackMetadata: Boolean(info.track && (info.artist || info.artists?.length)),
        strategy,
        durationToleranceSec,
      });
      logger.debug({ videoId, strategy, title: metadata.title, artist: metadata.artist, ...score }, 'Aday puanlandı');
      return { videoId, strategy, info, metadata, ...score };
    } catch (err) {
      logger.debug({ err, videoId }, 'Aday bilgisi alınamadı');
      return null;
    }
  }

  private cacheKey(meta: TrackMetadata): string {
    return meta.isrc
      ? `isrc:${meta.isrc}`
      : `q:${normalizeText(meta.artist)}|${normalizeText(meta.title)}|${meta.duration ?? ''}`;
  }

  private remember(key: string, value: ResolvedSource, expiry: Date | null): void {
    const ttl = Math.min(
      env.RESOLVER_CACHE_TTL_MS,
      expiry ? expiry.getTime() - Date.now() - STREAM_EXPIRY_MARGIN_MS : Number.POSITIVE_INFINITY,
    );
    if (ttl <= 0) return;
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttl });
  }
}

export const resolverService = new ResolverService();
