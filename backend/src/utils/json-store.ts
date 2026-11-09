import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from './logger.js';

/**
 * Küçük JSON dosyası deposu: açılışta okunur, değişiklikten kısa süre sonra
 * atomik olarak (geçici dosya + yeniden adlandırma) yazılır.
 */
export class JsonStore<T> {
  private value: T;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    fallback: T,
    validate: (raw: unknown) => T | null,
    private readonly delayMs = 500,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.value = fallback;
    if (existsSync(file)) {
      try {
        this.value = validate(JSON.parse(readFileSync(file, 'utf8'))) ?? fallback;
      } catch (err) {
        logger.warn({ err, file }, 'Veri dosyası okunamadı, boş başlatılıyor');
      }
    }
  }

  get data(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    this.schedule();
  }

  /** Yerinde değiştirilen veriyi kaydettirir */
  touch(): void {
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.writing = this.writing.then(() => this.write());
    }
    await this.writing;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writing = this.writing.then(() => this.write());
    }, this.delayMs);
    this.timer.unref();
  }

  private async write(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(this.value), 'utf8');
      await rename(tmp, this.file);
    } catch (err) {
      logger.warn({ err, file: this.file }, 'Veri dosyası kaydedilemedi');
    }
  }
}
