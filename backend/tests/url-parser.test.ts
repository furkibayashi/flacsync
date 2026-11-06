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
