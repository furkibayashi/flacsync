import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryService, type HistoryEntry } from '../src/services/history.service.js';

const entry = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  title: `Şarkı ${id}`,
  artist: 'Sanatçı',
  album: null,
  coverUrl: null,
  format: 'mp3',
  fileName: `${id}.mp3`,
  size: 1000,
  platform: 'deezer',
  sourceUrl: `https://www.deezer.com/track/${id}`,
  collection: null,
  durationMs: 5000,
  completedAt: new Date().toISOString(),
  ...over,
});

describe('HistoryService', () => {
  it('en yeni kayıt önce gelir, aynı kimlik tekrar eklenmez', () => {
    const h = new HistoryService(mkdtempSync(join(tmpdir(), 'fs-hist-')));
    h.add(entry('1'));
    h.add(entry('2'));
    h.add(entry('1', { title: 'güncel' }));
    expect(h.list().map((e) => e.id)).toEqual(['1', '2']);
    expect(h.list()[0]!.title).toBe('güncel');
  });

  it('istatistikler: toplam, boyut, son 7 gün, formatlar', () => {
    const h = new HistoryService(mkdtempSync(join(tmpdir(), 'fs-hist-')));
    h.add(entry('a', { size: 300, format: 'flac' }));
    h.add(entry('b', { size: 700, completedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }));
    expect(h.stats()).toEqual({ total: 2, totalBytes: 1000, last7Days: 1, formats: { mp3: 1, flac: 1 } });
  });

  it('diske yazar ve yeniden açılınca okur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-hist-'));
    const h = new HistoryService(dir);
    h.add(entry('x'));
    await h.flush();
    expect(JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8')).entries).toHaveLength(1);
    expect(new HistoryService(dir).list()[0]!.id).toBe('x');
  });

  it('bozuk dosyada boş başlar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-hist-'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'history.json'), '{bozuk');
    expect(new HistoryService(dir).size).toBe(0);
  });
});
