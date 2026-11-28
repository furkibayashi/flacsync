import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DownloadError, DownloaderService, isTruncated } from '../src/services/downloader.service.js';
import { errorInfo, JobsService } from '../src/services/jobs.service.js';
import { LibraryService } from '../src/services/library.service.js';
import type { TrackMetadata } from '../src/services/metadata/types.js';
import { isTransientFailure } from '../src/utils/download-errors.js';
import { pickRadio, radioScore, splitArtistNames } from '../../frontend/src/lib/radio.js';
import { dt, setDesktopLang, toDesktopLang } from '../../desktop/src/i18n.js';

describe('yarım indirme koruması', () => {
  it('beklenenin %80’inden kısa çıktıyı yarım sayar; kısa / süresiz parçada karar vermez', () => {
    expect(isTruncated(120, 300)).toBe(true);
    expect(isTruncated(290, 300)).toBe(false);
    expect(isTruncated(null, 300)).toBe(false);
    expect(isTruncated(5, null)).toBe(false);
    expect(isTruncated(5, 20)).toBe(false);
  });

  it('DOWNLOAD_TRUNCATED kodu korunur ve geçici hata sayılır (yeniden denenir)', () => {
    const err = new DownloadError('eksik', { code: 'DOWNLOAD_TRUNCATED' });
    expect(errorInfo(err).code).toBe('DOWNLOAD_TRUNCATED');
    expect(isTransientFailure('DOWNLOAD_TRUNCATED')).toBe(true);
  });
});

describe('DownloaderService.sweepOrphans', () => {
  it('sahipsiz klasörleri ve geçici dosyaları siler, sıradaki işlerinkini korur', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-orphans-'));
    const dl = join(root, 'downloads');
    const tmp = join(root, 'temp');
    const keep = '11111111-1111-4111-8111-111111111111';
    const gone = '22222222-2222-4222-8222-222222222222';
    for (const id of [keep, gone]) {
      mkdirSync(join(dl, id), { recursive: true });
      writeFileSync(join(dl, id, 'a.mp3'), 'x');
    }
    mkdirSync(join(dl, 'kullanici-klasoru'), { recursive: true });
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, `${gone}.audio.webm`), 'yarım');
    writeFileSync(join(tmp, `${keep}.audio.webm`), 'sürüyor');
    writeFileSync(join(tmp, 'baska.txt'), 'x');

    const removed = await new DownloaderService(dl, tmp).sweepOrphans(new Set([keep]));
    expect(removed).toBe(2);
    expect(existsSync(join(dl, gone))).toBe(false);
    expect(existsSync(join(tmp, `${gone}.audio.webm`))).toBe(false);
    expect(existsSync(join(dl, keep))).toBe(true);
    expect(existsSync(join(tmp, `${keep}.audio.webm`))).toBe(true);
    // UUID olmayan klasörlere / dosyalara dokunulmaz
    expect(existsSync(join(dl, 'kullanici-klasoru'))).toBe(true);
    expect(existsSync(join(tmp, 'baska.txt'))).toBe(true);
  });

  it('klasörler yoksa hata vermez', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-orphans-'));
    await expect(new DownloaderService(join(root, 'yok'), join(root, 'yok2')).sweepOrphans(new Set())).resolves.toBe(0);
  });
});

describe('albüm düzeyinde kuyruk kontrolleri', () => {
  const failed = (id: string, n: number) => ({
    id,
    url: `https://www.deezer.com/track/${n}`,
    format: 'mp3',
    options: { batchId: 'b1' },
    status: 'failed',
    error: { code: 'NO_MATCH', message: 'x', status: 404 },
    metadata: null,
    createdAt: new Date().toISOString(),
  });

  it('elle duraklatma, toplu yeniden deneme ve toplu iptal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-queue-'));
    const a = '33333333-3333-4333-8333-333333333333';
    const b = '44444444-4444-4444-8444-444444444444';
    writeFileSync(
      join(dir, 'queue.json'),
      JSON.stringify({
        jobs: [failed(a, 1), failed(b, 2)],
        batches: [{ id: 'b1', name: 'Albüm', folder: 'Albüm', format: 'mp3', jobIds: [a, b], createdAt: new Date().toISOString() }],
      }),
    );
    const jobs = new JobsService();
    jobs.restore(dir);
    // Duraklatılınca yeniden denenen işler başlamaz (testte ağa çıkılmaz)
    expect(jobs.pauseByUser()).toMatchObject({ paused: true, reason: 'USER' });

    expect(jobs.retryBatch('b1')).toBe(2);
    let snap = jobs.snapshot();
    expect(snap.stats).toMatchObject({ queued: 2, failed: 0 });
    // Yeni kimlikler toplu işte eskilerin yerini alır
    expect(snap.batches[0]!.jobIds).toHaveLength(2);
    expect(snap.batches[0]!.jobIds).not.toContain(a);

    expect(jobs.cancelBatch('b1')).toBe(2);
    snap = jobs.snapshot();
    expect(snap.stats).toMatchObject({ queued: 0, cancelled: 2 });
    expect(snap.batches[0]).toMatchObject({ cancelled: 2, status: 'failed' });

    expect(jobs.cancelBatch('yok')).toBeNull();
    expect(jobs.retryBatch('yok')).toBeNull();
    // Tekrar sürdürülebilir
    jobs.resume();
    expect(jobs.queueState.paused).toBe(false);
  });
});

describe('sevilen şarkılar', () => {
  const meta: TrackMetadata = {
    title: 'Bir Derdim Var',
    artist: 'mor ve ötesi',
    album: null,
    releaseDate: '2004',
    coverUrl: null,
    isrc: null,
    duration: 200,
  };

  it('kalp: ekler, çıkarır, listeler ve diske yazar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-like-'));
    const source = join(root, 'job.mp3');
    writeFileSync(source, Buffer.alloc(1024));
    const lib = new LibraryService(join(root, 'library'), join(root, 'data'), true);
    await lib.recordDownload('job-1', meta, { path: source, fileName: 'a.mp3' });
    const [track] = lib.list().tracks;
    expect(track!.likedAt).toBeNull();

    const liked = lib.setLiked(track!.id, true);
    expect(liked?.likedAt).toEqual(expect.any(String));
    // Tekrar sevmek tarihi değiştirmez
    expect(lib.setLiked(track!.id, true)?.likedAt).toBe(liked!.likedAt);
    expect(lib.likedIds()).toEqual([track!.id]);
    expect(lib.list().tracks[0]!.likedAt).toBe(liked!.likedAt);

    expect(lib.setLikedMany([track!.id, 'yok'], false)).toBe(1);
    expect(lib.likedIds()).toEqual([]);
    expect(lib.setLiked('0000000000000000', true)).toBeNull();

    lib.setLiked(track!.id, true);
    await lib.flush();
    const reopened = new LibraryService(join(root, 'library'), join(root, 'data'), true);
    expect(reopened.likedIds()).toEqual([track!.id]);
  });
});

describe('kütüphane radyosu', () => {
  const t = (id: string, artist: string, genre: string | null, year: string | null, playCount = 0) => ({ id, artist, genre, year, playCount });
  const library = [
    t('1', 'Duman', 'Rock', '2005'),
    t('2', 'Duman', 'Rock', '2009'),
    t('3', 'Duman', 'Rock', '2013'),
    t('4', 'Sezen Aksu', 'Pop', '1991'),
    t('5', 'Mor ve Ötesi', 'Rock', '2004'),
    t('6', 'Tarkan', 'Pop', '1997'),
  ];

  it('sanatçı adlarını ayırır', () => {
    expect(splitArtistNames('Duman, Sezen Aksu & Tarkan feat. Ajda')).toEqual(['duman', 'sezen aksu', 'tarkan', 'ajda']);
    expect(splitArtistNames('Lil Nas X')).toEqual(['lil nas x']);
  });

  it('aynı sanatçı ve tür en yüksek puanı alır', () => {
    const seed = t('0', 'Duman', 'Rock', '2006');
    expect(radioScore(library[0]!, [seed])).toBeGreaterThan(radioScore(library[4]!, [seed]));
    expect(radioScore(library[4]!, [seed])).toBeGreaterThan(radioScore(library[3]!, [seed]));
  });

  it('sıradakileri dışarıda bırakır, aynı sanatçıdan en fazla 2 şarkı seçer', () => {
    const seed = t('1', 'Duman', 'Rock', '2005');
    const picks = pickRadio([seed], library, new Set(['1']), 4, () => 0);
    expect(picks.map((p) => p.id)).not.toContain('1');
    expect(picks.filter((p) => p.artist === 'Duman')).toHaveLength(2);
    expect(picks[0]!.artist).toBe('Duman');
    expect(picks).toHaveLength(4);
  });

  it('kütüphanede başka şarkı yoksa boş döner', () => {
    expect(pickRadio([library[0]!], library, new Set(library.map((x) => x.id)))).toEqual([]);
  });
});

describe('masaüstü dili', () => {
  it('işletim sistemi dilini desteklenen dile çevirir, bilinmeyende İngilizce', () => {
    expect(toDesktopLang('tr-TR')).toBe('tr');
    expect(toDesktopLang('de_AT')).toBe('de');
    expect(toDesktopLang('ja-JP')).toBe('en');
    expect(toDesktopLang(undefined)).toBe('en');
  });

  it('bildirim metinleri seçilen dilde ve değişkenler yerleşir', () => {
    setDesktopLang('en');
    expect(dt('savedMany', { n: 3 })).toBe('3 files saved');
    setDesktopLang('tr');
    expect(dt('savedMany', { n: 3 })).toBe('3 dosya kaydedildi');
    setDesktopLang('xx');
    expect(dt('saved')).toBe('Kaydedildi');
  });
});
