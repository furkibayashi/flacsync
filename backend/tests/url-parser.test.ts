import { describe, expect, it } from 'vitest';
import { detectPlatform, parseMusicUrl } from '../src/services/metadata/url-parser.js';
import { MetadataError } from '../src/services/metadata/errors.js';

describe('detectPlatform', () => {
  it.each([
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 'spotify'],
    ['spotify:track:4cOdK2wGLETKBW3PvgPWqT', 'spotify'],
    ['https://spotify.link/abc123', 'spotify'],
    ['https://music.apple.com/tr/album/x/1440857781?i=1440857795', 'apple-music'],
    ['https://www.deezer.com/tr/track/3135556', 'deezer'],
    ['https://link.deezer.com/s/abc', 'deezer'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-music'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube-music'],
    ['https://soundcloud.com/a/b', null],
    ['not a url at all', null],
  ])('%s → %s', (url, expected) => {
    expect(detectPlatform(url)).toBe(expected);
  });
});

describe('parseMusicUrl', () => {
  it('Spotify (intl yolu + query parametreleri)', async () => {
    const p = await parseMusicUrl('https://open.spotify.com/intl-tr/track/4cOdK2wGLETKBW3PvgPWqT?si=abc');
    expect(p).toMatchObject({ platform: 'spotify', type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
  });

  it('Spotify URI', async () => {
    const p = await parseMusicUrl('spotify:album:4aawyAB9vmqN3uQ7FjRGTy');
    expect(p).toMatchObject({ platform: 'spotify', type: 'album', id: '4aawyAB9vmqN3uQ7FjRGTy' });
  });

  it('Apple Music albüm linkindeki ?i= şarkıyı işaret eder', async () => {
    const p = await parseMusicUrl('https://music.apple.com/tr/album/never-gonna/1558533900?i=1558534271');
    expect(p).toMatchObject({ platform: 'apple-music', type: 'track', id: '1558534271', storefront: 'tr' });
  });

  it('Apple Music song linki', async () => {
    const p = await parseMusicUrl('https://music.apple.com/us/song/never-gonna-give-you-up/1558534271');
    expect(p).toMatchObject({ type: 'track', id: '1558534271', storefront: 'us' });
  });

  it('Apple Music ?i= olmayan albüm linki albüm olarak ayrışır', async () => {
    const p = await parseMusicUrl('https://music.apple.com/tr/album/whenever/1558533900');
    expect(p).toMatchObject({ type: 'album', id: '1558533900' });
  });

  it('Deezer (dil önekli / öneksiz)', async () => {
    expect(await parseMusicUrl('https://www.deezer.com/tr/track/3135556')).toMatchObject({ type: 'track', id: '3135556' });
    expect(await parseMusicUrl('deezer.com/track/3135556')).toMatchObject({ type: 'track', id: '3135556' });
  });

  it('YouTube varyantları', async () => {
    for (const url of [
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=10',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect(await parseMusicUrl(url)).toMatchObject({ platform: 'youtube-music', type: 'track', id: 'dQw4w9WgXcQ' });
    }
  });

  it('YouTube Music albüm playlist’i', async () => {
    const p = await parseMusicUrl('https://music.youtube.com/playlist?list=OLAK5uy_abcdef');
    expect(p.type).toBe('album');
  });

  it('desteklenmeyen platform', async () => {
    await expect(parseMusicUrl('https://soundcloud.com/a/b')).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' });
  });

  it('tanınmayan yol', async () => {
    await expect(parseMusicUrl('https://open.spotify.com/search/foo')).rejects.toBeInstanceOf(MetadataError);
  });

  it('http(s) dışındaki protokoller reddedilir', async () => {
    await expect(parseMusicUrl('file:///etc/passwd')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });
});

describe('Amazon Music linkleri', () => {
  it('müzik linklerini tanır, alışveriş linklerini tanımaz', async () => {
    const { isAmazonMusicUrl } = await import('../src/services/metadata/amazon.js');
    expect(isAmazonMusicUrl('https://music.amazon.com/albums/B00CRMWMZ0')).toBe(true);
    expect(isAmazonMusicUrl('music.amazon.de/tracks/B00CRMWN4Y')).toBe(true);
    expect(isAmazonMusicUrl('https://www.amazon.com/dp/B00CRMWMZ0')).toBe(true);
    expect(isAmazonMusicUrl('https://www.amazon.com/s?k=kulaklik')).toBe(false);
    expect(isAmazonMusicUrl('https://open.spotify.com/track/x')).toBe(false);
  });

  it('albüm, albüm içindeki şarkı, şarkı ve çalma listesi linklerini ayrıştırır', async () => {
    const { parseAmazonUrl } = await import('../src/services/metadata/amazon.js');
    expect(parseAmazonUrl('https://music.amazon.com/albums/B00CRMWMZ0')).toMatchObject({ kind: 'album', asin: 'B00CRMWMZ0' });
    expect(parseAmazonUrl('https://music.amazon.com/albums/B00CRMWMZ0?trackAsin=B00CRMWN4Y')).toMatchObject({
      kind: 'track',
      asin: 'B00CRMWMZ0',
      trackAsin: 'B00CRMWN4Y',
    });
    expect(parseAmazonUrl('https://music.amazon.com/tracks/B00CRMWN4Y')).toMatchObject({ kind: 'track', asin: 'B00CRMWN4Y' });
    expect(parseAmazonUrl('https://music.amazon.com/playlists/B07XYZ1234')).toMatchObject({ kind: 'playlist' });
    expect(parseAmazonUrl('https://www.amazon.com/music/player/albums/B00CRMWMZ0')).toMatchObject({ kind: 'album', asin: 'B00CRMWMZ0' });
  });

  it('anahtarsız şarkı linkinde açıklayıcı hata, albümde MusicBrainz yolu', async () => {
    const { AmazonMusicResolver } = await import('../src/services/metadata/amazon.js');
    const resolver = new AmazonMusicResolver(async () => null, undefined);
    await expect(resolver.resolve('https://music.amazon.com/tracks/B00CRMWN4Y')).rejects.toMatchObject({ code: 'AMAZON_TRACK_NEEDS_KEY' });
    await expect(resolver.resolve('https://music.amazon.com/playlists/B07XYZ1234')).rejects.toMatchObject({ code: 'UNSUPPORTED_RESOURCE' });
  });
});
