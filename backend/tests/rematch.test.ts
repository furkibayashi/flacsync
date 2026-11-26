import { describe, expect, it } from 'vitest';
import { needsReview, sourceFromComment } from '../src/services/library.service.js';
import { parseVideoId } from '../src/services/rematch.service.js';
import { loudnessFromReplayGain, lrcPath, replayGainValue } from '../src/utils/sidecars.js';

describe('parseVideoId', () => {
  it('YouTube / YouTube Music bağlantılarından kimliği alır', () => {
    expect(parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('  dQw4w9WgXcQ ')).toBe('dQw4w9WgXcQ');
  });

  it('başka siteleri ve bozuk kimlikleri reddeder', () => {
    expect(parseVideoId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/watch?v=kısa')).toBeNull();
    expect(parseVideoId('https://open.spotify.com/track/123')).toBeNull();
    expect(parseVideoId('merhaba')).toBeNull();
  });
});

describe('Eşleşme kaynağı', () => {
  it('yorum etiketinden kaynağı okur', () => {
    expect(sourceFromComment('Source: YouTube Music dQw4w9WgXcQ (opus 129 kbps)')).toEqual({ videoId: 'dQw4w9WgXcQ', score: null });
    expect(sourceFromComment('Source: YouTube Music dQw4w9WgXcQ (opus 129 kbps, lossy origin)')?.videoId).toBe('dQw4w9WgXcQ');
    expect(sourceFromComment('Ripped by someone')).toBeNull();
    expect(sourceFromComment(null)).toBeNull();
  });

  it('yalnızca düşük güvenli, onaylanmamış, ISRC ile bulunmamış eşleşmeleri kontrole işaretler', () => {
    expect(needsReview({ videoId: 'x', score: 0.82, strategy: 'ytmusic-search' })).toBe(true);
    expect(needsReview({ videoId: 'x', score: 0.95, strategy: 'ytmusic-search' })).toBe(false);
    expect(needsReview({ videoId: 'x', score: 0.82, strategy: 'isrc' })).toBe(false);
    expect(needsReview({ videoId: 'x', score: 0.82, strategy: 'youtube-search', reviewed: true })).toBe(false);
    expect(needsReview({ videoId: 'x', score: null })).toBe(false);
    expect(needsReview(null)).toBe(false);
  });
});

describe('ReplayGain / .lrc yardımcıları', () => {
  it('kazancı LUFS referansıyla çevirir', () => {
    expect(replayGainValue(-11.5)).toBe('-6.50 dB');
    expect(replayGainValue(-20)).toBe('+2.00 dB');
    expect(loudnessFromReplayGain('-6.50 dB')).toBe(-11.5);
    expect(loudnessFromReplayGain('+2.00 dB')).toBe(-20);
    expect(loudnessFromReplayGain('bozuk')).toBeNull();
  });
  it('.lrc yolu ses dosyasıyla aynı adı taşır', () => {
    expect(lrcPath('C:/Müzik/Duman - Kırmızı.flac').split('\\').join('/')).toBe('C:/Müzik/Duman - Kırmızı.lrc');
  });
});
