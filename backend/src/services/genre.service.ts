import axios from 'axios';
import PQueue from 'p-queue';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { artistSimilarity, splitArtists, stripTitleNoise, titleSimilarity } from './matcher/similarity.js';

/**
 * Doğru tür bulma.
 *
 * Deezer'ın albüm türü güvenilmez: bilmediği her şeye "Pop" diyor (Judas Priest — Painkiller → Pop).
 * Bu yüzden kaynaklar şu sırayla kullanılır:
 *  1. iTunes şarkı türü (primaryGenreName) — belirginse (Metal, Turkish Rock, Hip-Hop/Rap …)
 *  2. MusicBrainz sanatçı türleri (topluluk oylu) — iTunes zayıf / boşsa (Pop, Soundtrack, Music)
 *  3. iTunes'un zayıf cevabı, sonra platformdan gelen tür (Deezer'ın "Pop"u en son)
 * Aynı türün farklı yazımları tek ada indirgenir ("Rap/Hip Hop", "hip hop" → "Hip-Hop/Rap").
 */

export interface GenreQuery {
  title: string;
  artist: string;
  album?: string | null;
  /** Platformdan gelen tür (Deezer / Apple); son çare */
  hint?: string | null;
}

export type GenreSource = 'itunes' | 'musicbrainz' | 'platform';

export interface GenreResult {
  genre: string | null;
  source: GenreSource | null;
}

/** Tek başına pek bir şey söylemeyen iTunes türleri */
const WEAK_ITUNES = new Set(['pop', 'soundtrack', 'music', 'singer/songwriter', 'vocal', 'easy listening', 'worldwide', 'world']);

/** Yazım birleştirme (küçük harf anahtar → gösterilecek ad). Deezer Türkçe ad da döndürebiliyor. */
const CANONICAL: Record<string, string> = {
  'rap/hip hop': 'Hip-Hop/Rap',
  'hip-hop/rap': 'Hip-Hop/Rap',
  'hip hop': 'Hip-Hop/Rap',
  'hip-hop': 'Hip-Hop/Rap',
  rap: 'Hip-Hop/Rap',
  'hardcore hip hop': 'Hip-Hop/Rap',
  'pop rap': 'Hip-Hop/Rap',
  'boom bap': 'Hip-Hop/Rap',
  trap: 'Hip-Hop/Rap',
  elektronik: 'Electronic',
  electronic: 'Electronic',
  electronica: 'Electronic',
  electro: 'Electronic',
  'french house': 'Electronic',
  house: 'Dance',
  techno: 'Electronic',
  dance: 'Dance',
  edm: 'Dance',
  'heavy metal': 'Metal',
  'thrash metal': 'Metal',
  'death metal': 'Metal',
  'black metal': 'Metal',
  'power metal': 'Metal',
  'speed metal': 'Metal',
  nwobhm: 'Metal',
  'nu metal': 'Metal',
  'alternative metal': 'Metal',
  metal: 'Metal',
  'hard rock': 'Hard Rock',
  'alternative rock': 'Alternative',
  'indie rock': 'Alternative',
  indie: 'Alternative',
  'alternatif': 'Alternative',
  alternative: 'Alternative',
  'art rock': 'Rock',
  'glam rock': 'Rock',
  'classic rock': 'Rock',
  'progressive rock': 'Rock',
  'psychedelic rock': 'Rock',
  'pop rock': 'Rock',
  'pop/rock': 'Rock',
  rock: 'Rock',
  'r&b': 'R&B/Soul',
  'r&b/soul': 'R&B/Soul',
  'contemporary r&b': 'R&B/Soul',
  soul: 'R&B/Soul',
  funk: 'R&B/Soul',
  jazz: 'Jazz',
  caz: 'Jazz',
  blues: 'Blues',
  classical: 'Classical',
  klasik: 'Classical',
  'klasik müzik': 'Classical',
  country: 'Country',
  reggae: 'Reggae',
  latin: 'Latin',
  'latin pop': 'Latin',
  reggaeton: 'Latin',
  pop: 'Pop',
  'dance-pop': 'Pop',
  'synth-pop': 'Pop',
  'film müzikleri': 'Soundtrack',
  'films/games': 'Soundtrack',
  soundtrack: 'Soundtrack',
  'singer/songwriter': 'Singer/Songwriter',
  'singer-songwriter': 'Singer/Songwriter',
  folk: 'Folk',
  arabesk: 'Arabesque',
  arabesque: 'Arabesque',
  'türk halk müziği': 'Turkish Folk',
  'turkish folk': 'Turkish Folk',
  'türk sanat müziği': 'Turkish Classical',
  'turkish rock': 'Turkish Rock',
  'turkish pop': 'Turkish Pop',
  'turkish hip-hop/rap': 'Turkish Hip-Hop/Rap',
  'turkish alternative': 'Turkish Alternative',
  'anatolian rock': 'Turkish Rock',
};

/** Tür adını ortak yazıma çevirir; bilinmiyorsa kelimeleri büyük harfle başlatır. */
export function canonicalGenre(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const key = value.toLowerCase();
  if (CANONICAL[key]) return CANONICAL[key];
  return value.replace(/(^|[\s/-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('en'));
}

const isWeak = (genre: string | null) => !genre || WEAK_ITUNES.has(genre.toLowerCase());

interface ITunesSong {
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
}

interface MbArtist {
  id: string;
  name: string;
  score?: number;
  genres?: { name: string; count: number }[];
}

export class GenreService {
  private readonly artistCache = new Map<string, string | null>();
  private readonly songCache = new Map<string, GenreResult>();
  /** MusicBrainz: saniyede en fazla 1 istek */
  private readonly mbQueue = new PQueue({ concurrency: 1, interval: 1100, intervalCap: 1 });
  private readonly userAgent =
    env.MUSICBRAINZ_USER_AGENT ?? 'FlacSync/1.4 ( https://github.com/furkibayashi/flacsync )';

  /** Şarkının türü. Hata fırlatmaz; hiçbir kaynak cevap vermezse platform türü (normalize edilmiş). */
  async resolve(q: GenreQuery): Promise<GenreResult> {
    const key = `${q.artist}|${q.title}`.toLowerCase();
    const cached = this.songCache.get(key);
    if (cached) return cached;

    const itunes = await this.fromITunes(q).catch((err: unknown) => {
      logger.debug({ err }, 'iTunes türü alınamadı');
      return null;
    });
    let result: GenreResult;
    if (itunes && !isWeak(itunes)) {
      result = { genre: canonicalGenre(itunes), source: 'itunes' };
    } else {
      const mb = await this.fromMusicBrainz(q.artist).catch((err: unknown) => {
        logger.debug({ err }, 'MusicBrainz türü alınamadı');
        return null;
      });
      const hint = canonicalGenre(q.hint);
      if (mb) result = { genre: mb, source: 'musicbrainz' };
      else if (itunes) result = { genre: canonicalGenre(itunes), source: 'itunes' };
      else result = { genre: hint, source: hint ? 'platform' : null };
    }

    if (this.songCache.size > 3000) this.songCache.clear();
    this.songCache.set(key, result);
    return result;
  }

  private async fromITunes(q: GenreQuery): Promise<string | null> {
    const artist = splitArtists(q.artist)[0] ?? q.artist;
    const title = stripTitleNoise(q.title);
    const { data } = await axios.get<{ results?: ITunesSong[] }>('https://itunes.apple.com/search', {
      params: { term: `${artist} ${title}`, entity: 'song', limit: 10, country: env.APPLE_MUSIC_STOREFRONT },
      timeout: 8000,
    });
    const best = (data.results ?? [])
      .map((s) => ({
        s,
        score: titleSimilarity(title, s.trackName ?? '') + artistSimilarity(q.artist, s.artistName ?? ''),
      }))
      .filter((x) => x.score >= 1.5)
      .sort((a, b) => b.score - a.score)[0];
    return best?.s.primaryGenreName ?? null;
  }

  /** Sanatçının en çok oy alan türü (adı birebir tutan sanatçı). */
  private async fromMusicBrainz(artistName: string): Promise<string | null> {
    const name = splitArtists(artistName)[0] ?? artistName;
    const key = name.toLowerCase();
    if (this.artistCache.has(key)) return this.artistCache.get(key) ?? null;

    const genre = await this.mbQueue.add(async () => {
      const { data } = await axios.get<{ artists?: MbArtist[] }>('https://musicbrainz.org/ws/2/artist', {
        params: { query: `artist:"${name.replace(/"/g, '')}"`, fmt: 'json', limit: 5 },
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        timeout: 10_000,
      });
      const match = (data.artists ?? []).find((a) => artistSimilarity(name, a.name) >= 0.9 && (a.score ?? 0) >= 90);
      if (!match) return null;
      // Arama sonucunda tür yok; sanatçı kaydı ayrıca istenir (yine sıradan geçer)
      return match.id;
    });
    let top: string | null = null;
    if (genre) {
      const detail = await this.mbQueue.add(() =>
        axios.get<MbArtist>(`https://musicbrainz.org/ws/2/artist/${genre}`, {
          params: { inc: 'genres', fmt: 'json' },
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          timeout: 10_000,
        }),
      );
      const genres = (detail?.data.genres ?? []).filter((g) => g.count >= 2).sort((a, b) => b.count - a.count);
      top = canonicalGenre(genres[0]?.name);
    }
    if (this.artistCache.size > 2000) this.artistCache.clear();
    this.artistCache.set(key, top);
    return top;
  }
}

export const genreService = new GenreService();
