import { describe, expect, it } from 'vitest';
import { hasUnwantedVariant, preScoreEntry, scoreCandidate } from '../src/services/resolver/candidate-scorer.js';
import { selectBestAudioFormat, streamExpiry, toAudioFormat } from '../src/services/resolver/format-selector.js';
import type { TrackMetadata } from '../src/services/metadata/types.js';
import type { YtDlpFormat } from '../src/utils/ytdlp.js';

const target: TrackMetadata = {
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  album: 'Whenever You Need Somebody',
  releaseDate: '1987',
  coverUrl: null,
  isrc: 'GBARL9300135',
  duration: 214,
};

const ctx = {
  rawTitle: 'Never Gonna Give You Up',
  channel: 'Rick Astley',
  hasOfficialTrackMetadata: true,
  strategy: 'ytmusic-search' as const,
  durationToleranceSec: 5,
};

describe('hasUnwantedVariant', () => {
  it('hedefte olmayan cover/karaoke/live elenir', () => {
    expect(hasUnwantedVariant('Song', 'Song (Karaoke Version)')).toBe(true);
    expect(hasUnwantedVariant('Song', 'Song sped up')).toBe(true);
    expect(hasUnwantedVariant('Song', 'Artist - Song (Live at Wembley)')).toBe(true);
  });

  it('hedefin kendisinde geçiyorsa elenmez', () => {
    expect(hasUnwantedVariant('Live Forever', 'Oasis - Live Forever')).toBe(false);
    expect(hasUnwantedVariant('Song (Live)', 'Song (Live)')).toBe(false);
  });
});

describe('preScoreEntry', () => {
  it('"Sanatçı - Şarkı (Official Video)" başlığını tanır', () => {
    expect(preScoreEntry(target, 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)')).toBe(1);
  });

  it('farklı versiyonu düşük puanlar', () => {
    expect(preScoreEntry(target, 'Never Gonna Give You Up (Pianoforte)')).toBeLessThan(0.6);
    expect(preScoreEntry(target, 'Never Gonna Give You Up (Karaoke)')).toBe(0);
  });
});

describe('scoreCandidate', () => {
  const candidate: TrackMetadata = { ...target, isrc: null, duration: 213 };

  it('resmî kayıt yüksek skor ve bonus alır', () => {
    const s = scoreCandidate(target, candidate, ctx);
    expect(s.score).toBeGreaterThan(0.95);
    expect(s.rank).toBeGreaterThan(s.score);
    expect(s.durationDiff).toBe(1);
  });

  it('±5 sn içindeki süre kabul, dışındaki red', () => {
    expect(scoreCandidate(target, { ...candidate, duration: 219 }, ctx).score).toBeGreaterThan(0.8);
    expect(scoreCandidate(target, { ...candidate, duration: 220 }, ctx).score).toBe(0);
  });

  it('ISRC ile bulunan aday, aynı skordaki arama sonucunun önüne geçer', () => {
    const viaSearch = scoreCandidate(target, candidate, ctx);
    const viaIsrc = scoreCandidate(target, candidate, { ...ctx, strategy: 'isrc' });
    expect(viaIsrc.rank).toBeGreaterThan(viaSearch.rank);
  });

  it('başlık parantez dışında "cover" içeriyorsa 0', () => {
    expect(scoreCandidate(target, candidate, { ...ctx, rawTitle: 'Never Gonna Give You Up cover by X' }).score).toBe(0);
  });
});

describe('selectBestAudioFormat', () => {
  const base = { url: 'https://x', vcodec: 'none', protocol: 'https' };
  const formats: YtDlpFormat[] = [
    { ...base, format_id: 'sb0', acodec: 'none', vcodec: 'none', protocol: 'mhtml' },
    { ...base, format_id: '139', ext: 'm4a', acodec: 'mp4a.40.5', abr: 48.9 },
    { ...base, format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', abr: 129.6 },
    { ...base, format_id: '251', ext: 'webm', acodec: 'opus', abr: 129.1, asr: 48000 },
    { ...base, format_id: '18', ext: 'mp4', acodec: 'mp4a.40.2', vcodec: 'avc1', abr: 300 },
    { ...base, format_id: '999', ext: 'm4a', acodec: 'mp4a.40.2', abr: 512, has_drm: true },
  ];

  it('DRM\'li ve video içeren formatları atlar, aynı bitrate\'te Opus\'u seçer', () => {
    expect(selectBestAudioFormat(formats)?.format_id).toBe('251');
  });

  it('daha yüksek bitrate\'li AAC (ör. Premium 256k) Opus 129k\'yı geçer', () => {
    const premium = { ...base, format_id: '141', ext: 'm4a', acodec: 'mp4a.40.2', abr: 256 };
    expect(selectBestAudioFormat([...formats, premium])?.format_id).toBe('141');
  });

  it('ses formatı yoksa null', () => {
    expect(selectBestAudioFormat([formats[0]!, formats[4]!])).toBeNull();
  });

  it('toAudioFormat kayıpsız değil olarak işaretler', () => {
    const f = toAudioFormat(formats[3]!);
    expect(f).toMatchObject({ formatId: '251', codec: 'opus', bitrateKbps: 129, sampleRate: 48000, isLossless: false });
  });
});

describe('streamExpiry', () => {
  it('googlevideo expire parametresini okur', () => {
    expect(streamExpiry('https://rr2.googlevideo.com/videoplayback?expire=1794019692&ei=x')?.toISOString()).toBe(
      new Date(1794019692 * 1000).toISOString(),
    );
    expect(streamExpiry('not a url')).toBeNull();
  });
});
