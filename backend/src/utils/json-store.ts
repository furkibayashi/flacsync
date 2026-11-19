import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { copyFile, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from './logger.js';

/**
 * Bozuk veri dosyasını kenara alır (".corrupt-<zaman>"), son sağlam yedeği (".bak") dener.
 * Eskiden bozuk dosyada boş başlanıyor ve ilk kayıtta dosya boşuyla eziliyordu: listeler,
 * senkron durumu, dinlenme sayıları kaybolurdu.
 */
export function readJsonSafely<T>(file: string, validate: (raw: unknown) => T | null): T | null {
  const tryRead = (path: string): T | null => {
    if (!existsSync(path)) return null;
    return validate(JSON.parse(readFileSync(path, 'utf8')));
  };
  try {
    return tryRead(file);
  } catch (err) {
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, aside);
    } catch {
      // kenara alınamazsa üzerine yazılmasın diye en azından kopyası
      try {
        copyFileSync(file, aside);
      } catch {
        /* yoksay */
      }
    }
    logger.warn({ err, file, aside }, 'Veri dosyası bozuk; kenara alındı, yedekten okunuyor');
    try {
      return tryRead(`${file}.bak`);
    } catch (bakErr) {
      logger.warn({ err: bakErr, file }, 'Yedek de okunamadı, boş başlatılıyor');
      return null;
    }
  }
}

/**
 * Yazmadan önce mevcut dosyanın yedeğini alır, geçici dosyaya yazıp diske işler (fsync) ve
 * yerine koyar: elektrik kesilse de yarım dosya kalmaz, son sağlam sürüm ".bak"ta durur.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (existsSync(file)) await copyFile(file, `${file}.bak`).catch(() => undefined);
  await rename(tmp, file);
}

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
    this.value = readJsonSafely(file, validate) ?? fallback;
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
    try {
      await writeJsonAtomic(this.file, this.value);
    } catch (err) {
      logger.warn({ err, file: this.file }, 'Veri dosyası kaydedilemedi');
    }
  }
}
