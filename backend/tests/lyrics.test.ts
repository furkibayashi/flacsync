import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LyricsNotFoundError, LyricsProviderError } from '../src/services/lyrics/errors.js';
import { isSyncedLrc, lrcToPlain, parseLrc } from '../src/services/lyrics/lrc.js';
import { LrcLibClient } from '../src/services/lyrics/lrclib.client.js';
import { LyricsService } from '../src/services/lyrics/lyrics.service.js';
import { embedLyricsInFile, readEmbeddedLyrics, vorbisLyricsArgs } from '../src/services/lyrics/tagger.js';
import type { Lyrics } from '../src/services/lyrics/types.js';
import { parseFfmetadata, readTags } from '../src/utils/audio-tags.js';
import { ffmpegPath } from '../src/utils/ffmpeg.js';

const LRC = '[ar: Sanatçı]\n[00:01.50] Birinci satır\n[00:03.20][00:10.00] Nakarat\n[00:05.123] Üçüncü';

describe('LRC', () => {
  it('zaman damgalarını ms olarak ayrıştırır, çoklu damgaları açar ve sıralar', () => {
    expect(parseLrc(LRC)).toEqual([
      { timeMs: 1500, text: 'Birinci satır' },
      { timeMs: 3200, text: 'Nakarat' },
      { timeMs: 5123, text: 'Üçüncü' },
      { timeMs: 10000, text: 'Nakarat' },
    ]);
    expect(isSyncedLrc(LRC)).toBe(true);
    expect(isSyncedLrc('düz söz')).toBe(false);
    expect(lrcToPlain('[00:01.00] a\n[00:02.00] b')).toBe('a\nb');
  });

  it('ffmetadata çıktısındaki çok satırlı ve kaçışlı değerleri okur', () => {
    const out = ';FFMETADATA1\ntitle=A \\= B\nLYRICS=[00:01.00] x\\\n[00:02.00] y\nartist=Z\n';
    expect(parseFfmetadata(out)).toEqual({ title: 'A = B', lyrics: '[00:01.00] x\n[00:02.00] y', artist: 'Z' });
  });
});

describe('LrcLibClient', () => {
  let server: Server;
  let base: string;
  const record = (over: Record<string, unknown>) => ({
    id: 1,
    trackName: 'Sevda Çiçeği',
    artistName: 'mor ve ötesi',
    albumName: 'Dünya Yalan Söylüyor',
    duration: 241,
    instrumental: false,
    plainLyrics: 'satır',
    syncedLyrics: null,
    ...over,
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const track = url.searchParams.get('track_name');
      res.setHeader('Content-Type', 'application/json');
      if (track === 'Hata') return res.writeHead(500).end('{}');
      if (url.pathname === '/api/get') {
        if (track === 'Sevda Çiçeği') return res.end(JSON.stringify(record({ syncedLyrics: '[00:01.00] a\n[00:02.00] b' })));
        return res.writeHead(404).end('{"code":404}');
      }
      if (url.pathname === '/api/search') {
        if (track === 'Arama') {
          return res.end(
            JSON.stringify([
              record({ id: 2, trackName: 'Arama', duration: 300, syncedLyrics: '[00:01.00] yanlış\n[00:02.00] süre' }),
              record({ id: 3, trackName: 'Arama', duration: 200, plainLyrics: 'düz' }),
              record({ id: 4, trackName: 'Arama', duration: 201, syncedLyrics: '[00:01.00] doğru\n[00:02.00] kayıt' }),
            ]),
          );
        }
        return res.end('[]');
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('birebir eşleşmeyi (/api/get) kullanır', async () => {
    const lyrics = await new LrcLibClient(base).find({ title: 'Sevda Çiçeği', artist: 'mor ve ötesi', duration: 241 });
    expect(lyrics.synced).toBe('[00:01.00] a\n[00:02.00] b');
    expect(lyrics.source).toBe('lrclib');
  });

  it('aramada süresi tutan ve zaman damgalı kaydı seçer', async () => {
    const lyrics = await new LrcLibClient(base).find({ title: 'Arama', artist: 'mor ve ötesi', duration: 200 });
    expect(lyrics.synced).toContain('doğru');
  });

  it('bulunamayınca LyricsNotFoundError, sunucu hatasında LyricsProviderError fırlatır', async () => {
    const client = new LrcLibClient(base);
    await expect(client.find({ title: 'Yok', artist: 'Kimse', duration: 100 })).rejects.toBeInstanceOf(LyricsNotFoundError);
    await expect(client.find({ title: 'Hata', artist: 'Kimse', duration: 100 })).rejects.toBeInstanceOf(LyricsProviderError);
  });

  it('servis hata fırlatmaz: bulunamazsa null, gömmede sonuç nesnesi döner', async () => {
    const service = new LyricsService(new LrcLibClient(base), true);
    expect(await service.find({ title: 'Hata', artist: 'Kimse' })).toBeNull();
    const result = await service.fetchAndEmbed(join(tmpdir(), 'yok.flac'), { title: 'Yok', artist: 'Kimse', duration: 1 });
    expect(result).toEqual({ status: 'not-found' });
    expect(await service.fetchAndEmbed('a.wav', { title: 'x', artist: 'y' })).toEqual({
      status: 'skipped',
      reason: 'unsupported-format',
    });
  });
});

describe('FLAC söz etiketleme', () => {
  const lyrics: Lyrics = {
    source: 'lrclib',
    synced: '[00:00.50] Merhaba = dünya; #1\n[00:01.20] İkinci satır',
    plain: 'Merhaba = dünya; #1\nİkinci satır',
    instrumental: false,
    match: null,
  };

  it('LYRICS ve UNSYNCEDLYRICS argümanlarını üretir', () => {
    expect(vorbisLyricsArgs(lyrics)).toEqual([
      '-metadata',
      `LYRICS=${lyrics.synced}`,
      '-metadata',
      `UNSYNCEDLYRICS=${lyrics.plain}`,
    ]);
  });

  it('var olan FLAC dosyasına sözleri yazar, ses ve diğer etiketler korunur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-lyr-'));
    const file = join(dir, 'test şarkı.flac');
    execFileSync(ffmpegPath!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'flac', '-metadata', 'title=Deneme', '-y', file]);
    const before = statSync(file).size;
    await embedLyricsInFile(file, lyrics);
    const read = await readEmbeddedLyrics(file);
    expect(read?.synced).toBe(lyrics.synced);
    expect(statSync(file).size).toBeGreaterThan(before * 0.9);
    const { tags } = await readTags(file);
    expect(tags.title).toBe('Deneme');
  }, 30_000);
});
