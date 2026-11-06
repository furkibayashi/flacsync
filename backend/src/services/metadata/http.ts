import axios from 'axios';
import { MetadataError } from './errors.js';
import type { Platform } from './types.js';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const http = axios.create({
  timeout: 10_000,
  headers: {
    'User-Agent': BROWSER_USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
  },
});

/** Axios hatalarını servis katmanının anladığı `MetadataError`'a çevirir. */
export function toProviderError(err: unknown, platform: Platform, context: string): MetadataError {
  if (err instanceof MetadataError) return err;

  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 404 || status === 400) {
      return new MetadataError('NOT_FOUND', `${context}: kayıt bulunamadı (HTTP ${status})`, {
        platform,
        cause: err,
      });
    }
    const detail = status ? `HTTP ${status}` : err.code ?? err.message;
    return new MetadataError('PROVIDER_ERROR', `${context}: istek başarısız (${detail})`, {
      platform,
      cause: err,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new MetadataError('PROVIDER_ERROR', `${context}: ${message}`, { platform, cause: err });
}
