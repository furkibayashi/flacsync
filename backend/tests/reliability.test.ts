import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorInfo, JobsService } from '../src/services/jobs.service.js';
import { classifyDownloadFailure, isTransientFailure, suggestsYtDlpUpdate } from '../src/utils/download-errors.js';
import { JsonStore, writeJsonAtomic } from '../src/utils/json-store.js';
import { parseSha256Sums } from '../src/utils/sha256sums.js';
import { songKey } from '../src/services/library/song-key.js';

describe('classifyDownloadFailure', () => {
  it('yt-dlp hata satırlarını anlamlı kodlara çevirir', () => {
    expect(classifyDownloadFailure("ERROR: [youtube] abc: Sign in to confirm you're not a bot")).toBe('YTDLP_BOT_CHECK');
    expect(classifyDownloadFailure('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toBe('YTDLP_FORBIDDEN');
    expect(classifyDownloadFailure('HTTP Error 429: Too Many Requests')).toBe('YTDLP_RATE_LIMITED');
    expect(classifyDownloadFailure('WARNING: nsig extraction failed: You may experience throttling')).toBe('YTDLP_OUTDATED');
    expect(classifyDownloadFailure('ERROR: [youtube] x: Video unavailable')).toBe('YTDLP_UNAVAILABLE');
    expect(classifyDownloadFailure('getaddrinfo ENOTFOUND music.youtube.com')).toBe('CONNECTION_ERROR');
    expect(classifyDownloadFailure('tuhaf bir şey')).toBe('DownloadError');
  });

  it('hangi hataların yeniden deneneceğini ve yt-dlp güncellemesi gerektirdiğini bilir', () => {
    expect(isTransientFailure('CONNECTION_ERROR')).toBe(true);
    expect(isTransientFailure('YTDLP_FORBIDDEN')).toBe(true);
    expect(isTransientFailure('NO_MATCH')).toBe(false);
    expect(isTransientFailure('YTDLP_UNAVAILABLE')).toBe(false);
    expect(suggestsYtDlpUpdate('YTDLP_OUTDATED')).toBe(true);
    expect(suggestsYtDlpUpdate('CONNECTION_ERROR')).toBe(false);
  });

  it('errorInfo genel hata kodlarını inceltir, özel kodlara dokunmaz', () => {
    const dl = Object.assign(new Error('Ses indirilemedi: ERROR: HTTP Error 403: Forbidden'), { name: 'DownloadError' });
    expect(errorInfo(dl).code).toBe('YTDLP_FORBIDDEN');
    const noMatch = Object.assign(new Error('eşleşme yok'), { code: 'NO_MATCH' });
    expect(errorInfo(noMatch).code).toBe('NO_MATCH');
  });
});

describe('Kalıcı indirme kuyruğu', () => {
  it('önceki oturumdan kalan başarısız işleri geri yükler, toplu işi korur', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-queue-'));
    writeFileSync(
      join(dir, 'queue.json'),
      JSON.stringify({
        jobs: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            url: 'https://www.deezer.com/track/1',
            format: 'mp3',
            options: { batchId: 'b1' },
            status: 'failed',
            error: { code: 'CONNECTION_ERROR', message: 'x', status: 502 },
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ],
        batches: [{ id: 'b1', name: 'Albüm', folder: 'Albüm', format: 'mp3', jobIds: ['11111111-1111-4111-8111-111111111111', 'gone'], createdAt: new Date().toISOString() }],
      }),
    );
    const jobs = new JobsService();
    expect(jobs.restore(dir)).toBe(0); // yeniden sıraya giren yok (yalnızca başarısız iş)
    const snap = jobs.snapshot();
    expect(snap.jobs).toHaveLength(1);
    expect(snap.jobs[0]).toMatchObject({ status: 'failed', batchId: 'b1', error: { code: 'CONNECTION_ERROR' } });
    // Kaybolan iş kimliği toplu işten düşer
    expect(snap.batches[0]).toMatchObject({ id: 'b1', total: 1, failed: 1, status: 'failed' });
    expect(snap.state.paused).toBe(false);
  });

  it('temizlik başarısız işleri bir hafta tutar (yeniden denenebilsinler)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-queue-'));
    writeFileSync(
      join(dir, 'queue.json'),
      JSON.stringify({
        jobs: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            url: 'https://www.deezer.com/track/2',
            format: 'mp3',
            options: {},
            status: 'failed',
            error: { code: 'CONNECTION_ERROR', message: 'x', status: 502 },
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ],
        batches: [],
      }),
    );
    const jobs = new JobsService();
    jobs.restore(dir);
    expect(await jobs.sweep(Date.now() + 3 * 60 * 60_000)).toBe(0);
    expect(jobs.snapshot().stats.failed).toBe(1);
    expect(await jobs.sweep(Date.now() + 8 * 24 * 60 * 60_000)).toBe(1);
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });
});

describe('parseSha256Sums', () => {
  const h = 'a'.repeat(64);
  it('metin ve ikili kip satırlarını okur', () => {
    expect(parseSha256Sums(`${h} *FlacSync-1.7.0.exe
`, 'FlacSync-1.7.0.exe')).toBe(h);
    expect(parseSha256Sums(`${h.toUpperCase()}  FlacSync-1.7.0.exe
`, 'FlacSync-1.7.0.exe')).toBe(h);
    expect(parseSha256Sums(`${h} *latest.yml`, 'FlacSync-1.7.0.exe')).toBeNull();
    expect(parseSha256Sums('bozuk satır', 'x')).toBeNull();
  });
});

describe('songKey', () => {
  it('Türkçe noktasız ı ve büyük İ farkını yok sayar', () => {
    expect(songKey('Duman', 'KIRMIZI')).toBe(songKey('duman', 'Kırmızı'));
    expect(songKey('Duman', 'Kirmizi')).toBe(songKey('DUMAN', 'Kırmızı (Remastered)'));
    expect(songKey('Sezen Aksu', 'İstanbul')).toBe(songKey('sezen aksu', 'istanbul'));
  });
});

describe('JsonStore', () => {
  it('bozuk dosyayı kenara alır ve son sağlam yedekten okur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-store-'));
    const file = join(dir, 'playlists.json');
    await writeJsonAtomic(file, [{ id: 'eski' }]);
    await writeJsonAtomic(file, [{ id: 'yeni' }]); // eski sürüm .bak'a geçer
    writeFileSync(file, '{ bozuk json');

    const store = new JsonStore<Array<{ id: string }>>(file, [], (raw) => (Array.isArray(raw) ? raw : null));
    expect(store.data).toEqual([{ id: 'eski' }]);
    expect(readdirSync(dir).some((f) => f.startsWith('playlists.json.corrupt-'))).toBe(true);
  });

  it('yedek de yoksa boş başlar ama bozuk dosyayı silmez', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-store-'));
    const file = join(dir, 'follows.json');
    writeFileSync(file, 'xx');
    const store = new JsonStore<string[]>(file, [], (raw) => (Array.isArray(raw) ? (raw as string[]) : null));
    expect(store.data).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith('follows.json.corrupt-'))).toBe(true);
  });
});
