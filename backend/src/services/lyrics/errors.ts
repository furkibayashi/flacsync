import type { LyricsErrorCode } from './types.js';

/** Şarkı sözü katmanının tek hata tipi; `code` ile ayrılır. */
export class LyricsError extends Error {
  readonly code: LyricsErrorCode;

  constructor(code: LyricsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LyricsError';
    this.code = code;
  }

  /** Bulunamadı, beklenen bir durumdur (uyarı değil bilgi olarak loglanır). */
  get isNotFound(): boolean {
    return this.code === 'LYRICS_NOT_FOUND';
  }
}

export class LyricsNotFoundError extends LyricsError {
  constructor(message = 'Şarkı sözü bulunamadı') {
    super('LYRICS_NOT_FOUND', message);
    this.name = 'LyricsNotFoundError';
  }
}

export class LyricsProviderError extends LyricsError {
  readonly status: number | null;

  constructor(message: string, status: number | null, options?: { cause?: unknown; timeout?: boolean }) {
    super(options?.timeout ? 'LYRICS_TIMEOUT' : 'LYRICS_PROVIDER_ERROR', message, options);
    this.name = 'LyricsProviderError';
    this.status = status;
  }
}

export class LyricsTagWriteError extends LyricsError {
  readonly file: string;

  constructor(file: string, message: string, options?: { cause?: unknown; unsupported?: boolean }) {
    super(options?.unsupported ? 'UNSUPPORTED_FILE' : 'TAG_WRITE_FAILED', message, options);
    this.name = 'LyricsTagWriteError';
    this.file = file;
  }
}

export const isLyricsError = (err: unknown): err is LyricsError => err instanceof LyricsError;
