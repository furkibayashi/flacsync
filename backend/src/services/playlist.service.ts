import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import sanitizeFilename from 'sanitize-filename';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/json-store.js';
import { libraryService } from './library.service.js';

/**
 * Çalma listeleri: kütüphanedeki şarkılardan oluşur (tam uzunlukta çalar).
 * M3U8 olarak dışa aktarılabilir — VLC, foobar2000, MusicBee, telefon oynatıcıları okur.
 */

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistSummary extends Playlist {
  /** Kütüphanede hâlâ bulunan şarkı sayısı */
  available: number;
  /** Kapak mozaiği için ilk 4 şarkı */
  coverIds: string[];
  duration: number;
}

const MAX_PLAYLISTS = 200;
const MAX_TRACKS = 5000;

function isPlaylist(v: unknown): v is Playlist {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds);
}

export class PlaylistError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'LIMIT',
    message: string,
  ) {
    super(message);
  }
}

export class PlaylistService {
  private readonly store: JsonStore<Playlist[]>;

  constructor(dataDir = resolve(env.DATA_DIR)) {
    this.store = new JsonStore<Playlist[]>(join(dataDir, 'playlists.json'), [], (raw) =>
      Array.isArray(raw) ? raw.filter(isPlaylist) : null,
    );
  }

  list(): PlaylistSummary[] {
    return this.store.data.map((p) => this.summarize(p)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): PlaylistSummary | null {
    const p = this.store.data.find((x) => x.id === id);
    return p ? this.summarize(p) : null;
  }

  create(name: string, trackIds: string[] = []): PlaylistSummary {
    if (this.store.data.length >= MAX_PLAYLISTS) throw new PlaylistError('LIMIT', 'Çok fazla çalma listesi');
    const now = new Date().toISOString();
    const playlist: Playlist = { id: randomUUID(), name: name.trim(), trackIds: unique(trackIds), createdAt: now, updatedAt: now };
    this.store.set([...this.store.data, playlist]);
    return this.summarize(playlist);
  }

  update(id: string, patch: { name?: string; trackIds?: string[] }): PlaylistSummary {
    const p = this.require(id);
    if (patch.name !== undefined) p.name = patch.name.trim();
    if (patch.trackIds !== undefined) p.trackIds = unique(patch.trackIds).slice(0, MAX_TRACKS);
    p.updatedAt = new Date().toISOString();
    this.store.touch();
    return this.summarize(p);
  }

  /** Şarkıları sona ekler (zaten olanlar tekrar eklenmez). */
  add(id: string, trackIds: string[]): PlaylistSummary {
    const p = this.require(id);
    return this.update(id, { trackIds: [...p.trackIds, ...trackIds] });
  }

  remove(id: string): boolean {
    const before = this.store.data.length;
    this.store.set(this.store.data.filter((p) => p.id !== id));
    return this.store.data.length < before;
  }

  /** M3U8 metni. `base` verilirse yollar ona göre göreli yazılır (liste müzik klasörüne kaydedilince). */
  toM3u(id: string, base?: string): { name: string; content: string } {
    const p = this.require(id);
    const lines = ['#EXTM3U', `#PLAYLIST:${p.name}`];
    for (const trackId of p.trackIds) {
      const track = libraryService.track(trackId);
      const file = libraryService.filePath(trackId);
      if (!track || !file) continue;
      lines.push(`#EXTINF:${track.duration ?? -1},${track.artist} - ${track.title}`);
      lines.push(base ? relative(base, file) : file);
    }
    return { name: p.name, content: `${lines.join('\r\n')}\r\n` };
  }

  /** Listeyi kütüphane klasöründeki "Playlists" klasörüne kaydeder; dosya yolunu döndürür. */
  async exportToLibrary(id: string): Promise<string> {
    const dir = join(libraryService.dir, 'Playlists');
    await mkdir(dir, { recursive: true });
    const { name, content } = this.toM3u(id, dir);
    const file = join(dir, `${sanitizeFilename(name, { replacement: '_' }).trim() || 'playlist'}.m3u8`);
    await writeFile(file, `﻿${content}`, 'utf8');
    return file;
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  private require(id: string): Playlist {
    const p = this.store.data.find((x) => x.id === id);
    if (!p) throw new PlaylistError('NOT_FOUND', 'Çalma listesi bulunamadı');
    return p;
  }

  private summarize(p: Playlist): PlaylistSummary {
    const present = p.trackIds.filter((id) => libraryService.track(id) && libraryService.filePath(id));
    return {
      ...p,
      available: present.length,
      coverIds: present.slice(0, 4),
      duration: present.reduce((sum, id) => sum + (libraryService.track(id)?.duration ?? 0), 0),
    };
  }
}

const unique = (ids: string[]) => [...new Set(ids.filter((x) => /^[0-9a-f]{16}$/.test(x)))];

export const playlistService = new PlaylistService();
