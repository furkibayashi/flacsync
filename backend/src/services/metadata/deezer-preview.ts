import { env } from '../../config/env.js';
import { http } from './http.js';

/**
 * Deezer önizleme linkleri imzalıdır ve ~15 dakikada süresi dolar (hdnea=exp=…).
 * Arayüz sayfayı uzun süre açık tutabildiği için doğrudan link yerine bu kalıcı adres verilir;
 * sunucu her istekte geçerli bir linke yönlendirir.
 */
export const deezerPreviewPath = (trackId: number | string) => `/api/preview/deezer/${trackId}`;

/** Önizleme varsa kalıcı adres, yoksa null */
export const stableDeezerPreview = (trackId: number | string, preview: string | null | undefined) =>
  preview ? deezerPreviewPath(trackId) : null;

const cache = new Map<string, { url: string | null; expiresAt: number }>();
/** İmzalı link ~15 dk geçerli; güvenli payla 5 dk saklanır */
const TTL_MS = 5 * 60_000;

/** Şarkının güncel önizleme linki (yoksa null). */
export async function freshDeezerPreview(trackId: string): Promise<string | null> {
  const hit = cache.get(trackId);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const { data } = await http.get<{ preview?: string; error?: unknown }>(`${env.DEEZER_API_BASE_URL}/track/${trackId}`);
  const url = data && !data.error && data.preview ? data.preview : null;
  if (cache.size > 2000) cache.clear();
  cache.set(trackId, { url, expiresAt: Date.now() + TTL_MS });
  return url;
}
