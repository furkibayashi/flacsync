import { describe, expect, it } from 'vitest';
import { rankAlbums, rankCandidates, relevance, tokenCoverage } from '../src/services/search/ranking.js';
import type { AlbumCandidate, SearchCandidate } from '../src/services/search/types.js';

const album = (over: Partial<AlbumCandidate> & Pick<AlbumCandidate, 'source' | 'title' | 'artist'>): AlbumCandidate => ({
  url: `https://example/${over.source}/album/${encodeURIComponent(over.title)}`,
  coverUrl: null,
  trackCount: 14,
  releaseYear: null,
  position: 0,
  ...over,
});

describe('rankAlbums', () => {
  const albums: AlbumCandidate[] = [
    album({ source: 'deezer', title: 'Discovery', artist: 'Daft Punk', position: 0 }),
    album({ source: 'deezer', title: 'Discovery', artist: 'Data Punk', position: 1, trackCount: 16 }),
    album({ source: 'apple-music', title: 'Discovery', artist: 'Daft Punk', releaseYear: '2001', position: 0 }),
    album({ source: 'apple-music', title: 'Random Access Memories', artist: 'Daft Punk', position: 1 }),
  ];

  it('aynı albümü platformlar arası birleştirir, Deezer linkini seçer', () => {
    const [first] = rankAlbums('daft punk discovery', albums, 4);
    expect(first).toMatchObject({ title: 'Discovery', artist: 'Daft Punk', releaseYear: '2001' });
    expect(first!.sources.sort()).toEqual(['apple-music', 'deezer']);
    expect(first!.url).toContain('/deezer/');
  });

  it('benzer adlı başka sanatçının aynı adlı albümünü göstermez', () => {
    const list = rankAlbums('daft punk discovery', albums, 4).map((a) => a.artist);
    expect(list).not.toContain('Data Punk');
  });

  it('yalnızca albüm adı aranınca o adlı albümler gelir', () => {
    expect(rankAlbums('discovery', albums, 4).map((a) => a.title)).toContain('Discovery');
  });

  it('sanatçı adı aranınca sanatçının albümleri gelir', () => {
    const titles = rankAlbums('daft punk', albums, 4).map((a) => `${a.artist} - ${a.title}`);
    expect(titles).toContain('Daft Punk - Random Access Memories');
    expect(titles).not.toContain('Data Punk - Discovery');
  });

  it('şarkı adı aramasında alakasız albüm göstermez', () => {
    const list = rankAlbums('tarkan şımarık', [album({ source: 'deezer', title: 'Ölürüm Sana', artist: 'Tarkan' })], 4);
    expect(list).toHaveLength(0);
  });
});

const base = {
  album: null,
  releaseYear: null,
  coverUrl: null,
  isrc: null,
  popularity: null,
} satisfies Partial<SearchCandidate>;

const c = (over: Partial<SearchCandidate> & Pick<SearchCandidate, 'source' | 'title' | 'artist'>): SearchCandidate => ({
  ...base,
  sourceId: `${over.source}-${over.title}`,
  url: `https://example/${over.source}/${encodeURIComponent(over.title)}`,
  duration: 226,
  position: 0,
  ...over,
});

describe('tokenCoverage', () => {
  it('Türkçe karakter ve küçük yazım hatalarına toleranslı', () => {
    expect(tokenCoverage('tarkan simarik', 'Tarkan Şımarık')).toBe(1);
    expect(tokenCoverage('daft punk harder', 'Daft Punk Harder, Better, Faster, Stronger')).toBe(1);
    expect(tokenCoverage('bohemian rapsody', 'Queen Bohemian Rhapsody')).toBe(1);
  });

  it('eksik kelimeler oranı düşürür', () => {
    expect(tokenCoverage('daft punk around the world', 'Daft Punk One More Time')).toBeLessThan(0.5);
  });
});

describe('relevance', () => {
  it('sanatçı + başlık sorgusu tam eşleşmede yüksek', () => {
    expect(relevance('queen bohemian rhapsody', { title: 'Bohemian Rhapsody', artist: 'Queen', album: null })).toBeGreaterThan(0.9);
  });
});

describe('rankCandidates', () => {
  const query = 'daft punk harder better faster stronger';

  const candidates: SearchCandidate[] = [
    c({ source: 'deezer', title: 'Harder, Better, Faster, Stronger (Live)', artist: 'Daft Punk', duration: 320, position: 0, popularity: 0.8 }),
    c({ source: 'deezer', title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk', album: 'Discovery', position: 1, popularity: 0.95 }),
    c({ source: 'deezer', title: 'Harder Better Faster Stronger (Karaoke Version)', artist: 'Karaoke Hits', position: 2, popularity: 0.2 }),
    c({ source: 'apple-music', title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk', album: 'Discovery', releaseYear: '2001', duration: 225, position: 0 }),
    c({ source: 'apple-music', title: 'Stronger', artist: 'Kanye West', duration: 312, position: 1 }),
  ];

  const results = rankCandidates(query, candidates, 8);

  it('orijinal kaydı en üste koyar ve platformları birleştirir', () => {
    const best = results[0]!;
    expect(best.title).toBe('Harder, Better, Faster, Stronger');
    expect(best.sources.sort()).toEqual(['apple-music', 'deezer']);
    expect(best.releaseYear).toBe('2001');
    // İndirme linki Deezer'dan (ISRC + albüm verir)
    expect(best.url).toContain('/deezer/');
  });

  it('istenmeyen live/karaoke sürümleri aşağıda kalır', () => {
    const titles = results.map((r) => r.title);
    expect(titles.indexOf('Harder, Better, Faster, Stronger (Live)')).toBeGreaterThan(0);
    const karaoke = results.find((r) => r.title.includes('Karaoke'));
    if (karaoke) expect(karaoke.score).toBeLessThan(results[0]!.score);
  });

  it('alakasız sonuçları eler', () => {
    expect(results.some((r) => r.artist === 'Kanye West')).toBe(false);
  });

  it('sorgu "live" istiyorsa canlı sürüm öne çıkar', () => {
    const live = rankCandidates(`${query} live`, candidates, 8);
    expect(live[0]!.title).toContain('Live');
  });

  it('ISRC aynıysa farklı başlık yazımlarını da birleştirir', () => {
    const merged = rankCandidates('song', [
      c({ source: 'deezer', title: 'Song', artist: 'A', isrc: 'USAAA0000001' }),
      c({ source: 'spotify', title: 'Song - 2011 Remaster', artist: 'A', isrc: 'USAAA0000001' }),
    ], 5);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources).toHaveLength(2);
  });
});
