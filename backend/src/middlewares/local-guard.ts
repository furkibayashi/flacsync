import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

/**
 * Yerel API koruması.
 *
 * Uygulama 127.0.0.1'de kimlik doğrulamasız çalışır; tarayıcıda açık herhangi bir site
 * şu iki yolla ona istek gönderebilirdi:
 *  - CSRF: başka sitenin "no-cors" POST'u ya da <img src="http://127.0.0.1:47821/api/..."> isteği
 *    (CORS yalnızca yanıtı okumayı engeller, isteğin gitmesini değil).
 *  - DNS rebinding: saldırganın alan adı 127.0.0.1'e çözülür; tarayıcı bunu "aynı köken" sayar.
 *
 * Kurallar:
 *  1. Host başlığı yalnızca localhost / 127.0.0.1 / ::1 ya da ev ağı IP'si olabilir. Rebinding
 *     bir alan adı gerektirdiği için bu tek kural onu tamamen keser.
 *  2. Tarayıcının "cross-site" dediği istekler (Sec-Fetch-Site) reddedilir.
 *  3. Değişiklik yapan isteklerde (POST/PUT/PATCH/DELETE) Origin / Referer varsa izinli bir
 *     köken olmalıdır.
 */

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** "192.168.1.5:47822" → "192.168.1.5"; "[::1]:4000" → "[::1]" */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.replace(/:\d+$/, '');
}

/** Ev / ofis ağı IPv4 adresi (telefona gönderme sunucusu bu adresle çağrılır) */
function isPrivateIPv4(name: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = hostName(host);
  return LOCAL_NAMES.has(name) || isPrivateIPv4(name);
}

function originHost(value: string | undefined): string | null {
  if (!value || value === 'null') return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

const extraOrigins = () =>
  env.CORS_ORIGIN.split(',')
    .map((o) => originHost(o.trim()))
    .filter((h): h is string => Boolean(h));

export interface GuardInput {
  method: string;
  host?: string;
  origin?: string;
  referer?: string;
  secFetchSite?: string;
}

/** İzin verilmeyen isteklerde nedenini, izinlide null döndürür (test edilebilir saf fonksiyon). */
export function guardReason(req: GuardInput, allowedOriginHosts: string[] = extraOrigins()): string | null {
  if (!isAllowedHost(req.host)) return 'host';
  // "same-site" de reddedilir: localhost'un başka bir portundaki sayfa (başka bir geliştirme
  // sunucusu, yerel bir web uygulaması) tarayıcıya göre aynı sitedir ama FlacSync değildir.
  if (req.secFetchSite === 'cross-site' || req.secFetchSite === 'same-site') return 'cross-site';
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  // "null" köken (sandbox iframe, file://) değişiklik yapamaz
  if (req.origin === 'null') return 'origin';
  const from = (originHost(req.origin) ?? originHost(req.referer))?.toLowerCase();
  // Köken, port dahil isteğin gittiği adresle aynı olmalı (ya da açıkça izin verilmiş olmalı)
  if (from && from !== req.host?.trim().toLowerCase() && !allowedOriginHosts.includes(from)) return 'origin';
  return null;
}

export function localGuard(req: Request, res: Response, next: NextFunction): void {
  const reason = guardReason({
    method: req.method,
    host: req.headers.host,
    origin: req.headers.origin,
    referer: req.headers.referer,
    secFetchSite: req.get('sec-fetch-site'),
  });
  if (!reason) return next();
  req.log?.warn({ reason, host: req.headers.host, origin: req.headers.origin, url: req.originalUrl }, 'Engellenen istek');
  res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Bu istek yalnızca FlacSync uygulamasından yapılabilir' } });
}
