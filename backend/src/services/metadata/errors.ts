import type { Platform } from './types.js';

export type MetadataErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_RESOURCE'
  | 'NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'CONFIG_MISSING';

const STATUS_BY_CODE: Record<MetadataErrorCode, number> = {
  INVALID_URL: 400,
  UNSUPPORTED_PLATFORM: 400,
  UNSUPPORTED_RESOURCE: 422,
  NOT_FOUND: 404,
  PROVIDER_ERROR: 502,
  CONFIG_MISSING: 500,
};

export class MetadataError extends Error {
  readonly code: MetadataErrorCode;
  readonly platform?: Platform;

  constructor(
    code: MetadataErrorCode,
    message: string,
    options: { platform?: Platform; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'MetadataError';
    this.code = code;
    this.platform = options.platform;
  }

  /** Controller katmanında HTTP yanıt kodu olarak kullanılır. */
  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export const isNotFound = (err: unknown): boolean =>
  err instanceof MetadataError && err.code === 'NOT_FOUND';
