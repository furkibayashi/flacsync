import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { Platform } from './metadata/types.js';

/** Ana sayfadaki "Son indirilenler" kaydı — uygulama kapanıp açılınca da durur. */
export interface HistoryEntry {
  /** İndirme işinin kimliği (masaüstünde "Klasörde göster" bununla bulunur) */
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  format: 'mp3' | 'flac';
  fileName: string;
  size: number;
  platform: Platform | null;
  /** Yeniden indirmek için kaynak link */
  sourceUrl: string;
  /** Toplu işin adı (albüm / çalma listesi) */
  collection: string | null;
  /** Toplam süre (ms) */
  durationMs: number | null;
  completedAt: string;
}

export interface HistoryStats {
  total: number;
  totalBytes: number;
  last7Days: number;
  formats: Record<'mp3' | 'flac', number>;
}

const MAX_ENTRIES = 1000;
const WRITE_DELAY_MS = 500;

export class HistoryService {
  private entries: HistoryEntry[] = [];
  private readonly file: string;
  private writeTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(dir = resolve(env.DATA_DIR)) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'history.json');
    this.load();
  }

  list(limit = 50, offset = 0): HistoryEntry[] {
    return this.entries.slice(offset, offset + limit);
  }

  get size(): number {
    return this.entries.length;
  }

  stats(now = Date.now()): HistoryStats {
    const weekAgo = now - 7 * 24 * 60 * 60_000;
    const formats = { mp3: 0, flac: 0 };
    let totalBytes = 0;
    let last7Days = 0;
    for (const e of this.entries) {
      totalBytes += e.size;
      formats[e.format]++;
      if (Date.parse(e.completedAt) >= weekAgo) last7Days++;
    }
    return { total: this.entries.length, totalBytes, last7Days, formats };
  }

  add(entry: HistoryEntry): void {
    this.entries = [entry, ...this.entries.filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES);
    this.scheduleWrite();
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return false;
    this.scheduleWrite();
    return true;
  }

  clear(): void {
    this.entries = [];
    this.scheduleWrite();
  }

  /** Bekleyen yazmayı hemen diske döker (kapanışta). */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      this.writing = this.writing.then(() => this.write());
    }
    await this.writing;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { entries?: HistoryEntry[] };
      this.entries = Array.isArray(data.entries) ? data.entries.slice(0, MAX_ENTRIES) : [];
    } catch (err) {
      logger.warn({ err, file: this.file }, 'İndirme geçmişi okunamadı, boş başlatılıyor');
      this.entries = [];
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writing = this.writing.then(() => this.write());
    }, WRITE_DELAY_MS);
    this.writeTimer.unref();
  }

  /** Yarım yazılmış dosya kalmasın diye önce geçici dosyaya yazıp yeniden adlandırır. */
  private async write(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, entries: this.entries }), 'utf8');
      await rename(tmp, this.file);
    } catch (err) {
      logger.warn({ err, file: this.file }, 'İndirme geçmişi kaydedilemedi');
    }
  }
}

export const historyService = new HistoryService();
