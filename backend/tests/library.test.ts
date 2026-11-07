import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryService } from '../src/services/library.service.js';
import type { TrackMetadata } from '../src/services/metadata/types.js';

const meta: TrackMetadata = {
  title: 'Sevda Çiçeği',
  artist: 'mor ve ötesi',
  album: 'Dünya Yalan Söylüyor',
  releaseDate: '2004',
  coverUrl: 'https://example.com/c.jpg',
  isrc: null,
  duration: 241,
  genre: 'Rock',
};

function setup(copy: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'fs-lib-'));
  const libDir = join(root, 'library');
  const source = join(root, 'job.mp3');
  writeFileSync(source, Buffer.alloc(2048));
  return { root, libDir, source, lib: new LibraryService(libDir, join(root, 'data'), copy) };
}

describe('LibraryService', () => {
  it('kopyalama açıkken tamamlanan dosyayı klasörüne kopyalar ve indirme metadata’sını kullanır', async () => {
    const { lib, libDir, source } = setup(true);
    await lib.recordDownload('job-1', meta, { path: source, fileName: 'mor ve ötesi - Sevda Çiçeği.mp3' }, {
      folder: 'Dünya Yalan Söylüyor',
      trackNumber: 3,
    });
    const { tracks, genres } = lib.list();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ title: 'Sevda Çiçeği', genre: 'Rock', trackNumber: 3, format: 'mp3' });
    expect(tracks[0]!.relativePath).toBe('Dünya Yalan Söylüyor/mor ve ötesi - Sevda Çiçeği.mp3');
    expect(existsSync(join(libDir, 'Dünya Yalan Söylüyor', 'mor ve ötesi - Sevda Çiçeği.mp3'))).toBe(true);
    expect(genres).toEqual([{ name: 'Rock', count: 1 }]);
  });

  it('masaüstü modunda kopyalamaz, attach ile kaydedilen yolu ekler', async () => {
    const { lib, libDir, root } = setup(false);
    await lib.recordDownload('job-2', meta, { path: join(root, 'job.mp3'), fileName: 'x.mp3' });
    expect(lib.list().tracks).toHaveLength(0);

    mkdirSync(libDir, { recursive: true });
    const saved = join(libDir, 'kaydedilen.mp3');
    writeFileSync(saved, Buffer.alloc(1024));
    await lib.attach('job-2', saved);
    const [track] = lib.list().tracks;
    expect(track).toMatchObject({ title: 'Sevda Çiçeği', relativePath: 'kaydedilen.mp3', size: 1024 });
    expect(lib.filePath(track!.id)).toBe(saved);
  });

  it('silinen dosyalar listeden düşer ve taramada çıkarılır; bilinmeyen kimlik okunamaz', async () => {
    const { lib, source } = setup(true);
    await lib.recordDownload('job-3', meta, { path: source, fileName: 'a.mp3' });
    const [track] = lib.list().tracks;
    rmSync(lib.filePath(track!.id)!);
    expect(lib.list().tracks).toHaveLength(0);
    expect(await lib.rescan()).toEqual({ added: 0, removed: 1 });
    expect(lib.filePath('0000000000000000')).toBeNull();
  });
});
