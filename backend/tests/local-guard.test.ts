import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardReason, isAllowedHost, localGuard } from '../src/middlewares/local-guard.js';

describe('isAllowedHost', () => {
  it('yerel adları ve ev ağı IP adreslerini kabul eder', () => {
    for (const h of ['127.0.0.1:47821', 'localhost:5173', '[::1]:4000', '192.168.1.20:47822', '10.0.0.5', '172.20.3.4:47822']) {
      expect(isAllowedHost(h)).toBe(true);
    }
  });

  it('alan adlarını (DNS rebinding) ve genel IP adreslerini reddeder', () => {
    for (const h of ['evil.example:47821', 'localhost.evil.com', '127.0.0.1.nip.io', '8.8.8.8', '172.32.0.1', undefined]) {
      expect(isAllowedHost(h)).toBe(false);
    }
  });
});

describe('guardReason', () => {
  const local = { host: '127.0.0.1:47821' };

  it('uygulamanın kendi isteklerine izin verir', () => {
    expect(guardReason({ ...local, method: 'GET' }, [])).toBeNull();
    expect(guardReason({ ...local, method: 'POST', origin: 'http://127.0.0.1:47821', secFetchSite: 'same-origin' }, [])).toBeNull();
    // Geliştirme: Vite (5173) → API (4000), CORS_ORIGIN ile izinli
    expect(guardReason({ method: 'POST', host: 'localhost:4000', origin: 'http://localhost:5173' }, ['localhost:5173'])).toBeNull();
    // Telefona gönderme sunucusu: köken = Host
    expect(guardReason({ method: 'POST', host: '192.168.1.20:47822', origin: 'http://192.168.1.20:47822' }, [])).toBeNull();
    // Origin'siz istemciler (curl, Electron ana süreç) yerelden gelir
    expect(guardReason({ ...local, method: 'DELETE' }, [])).toBeNull();
  });

  it('başka sitelerden gelen değişiklik isteklerini engeller', () => {
    expect(guardReason({ ...local, method: 'POST', origin: 'https://evil.example' }, [])).toBe('origin');
    expect(guardReason({ ...local, method: 'POST', origin: 'null' }, [])).toBe('origin');
    expect(guardReason({ ...local, method: 'POST', referer: 'https://evil.example/x' }, [])).toBe('origin');
    // <img src="…/api/download?url=…"> gibi çapraz site GET'ler de
    expect(guardReason({ ...local, method: 'GET', secFetchSite: 'cross-site' }, [])).toBe('cross-site');
    // localhost'un başka portundaki sayfa: tarayıcıya göre "same-site", ama FlacSync değil
    expect(guardReason({ ...local, method: 'GET', secFetchSite: 'same-site' }, [])).toBe('cross-site');
    expect(guardReason({ ...local, method: 'POST', origin: 'http://localhost:3000' }, [])).toBe('origin');
    expect(guardReason({ ...local, method: 'DELETE', origin: 'http://127.0.0.1:8080' }, [])).toBe('origin');
  });

  it('DNS rebinding ile gelen istekleri (yabancı Host) engeller', () => {
    expect(guardReason({ method: 'GET', host: 'attacker.example:47821' }, [])).toBe('host');
    expect(guardReason({ method: 'DELETE', host: 'attacker.example:47821', origin: 'http://attacker.example:47821' }, [])).toBe('host');
  });
});

describe('localGuard (HTTP)', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use('/api', localGuard);
    app.post('/api/library/organize/apply', (_req, res) => {
      res.json({ moved: true });
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const send = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/library/organize/apply', headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });

  it('başka sitenin "no-cors" POST\'u kütüphaneyi düzenleyemez', async () => {
    expect(await send({ Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'Content-Type': 'text/plain' })).toBe(403);
  });

  it('rebinding alan adıyla gelen istek reddedilir', async () => {
    expect(await send({ Host: `rebind.evil.example:${port}` })).toBe(403);
  });

  it('uygulamanın kendi isteği geçer', async () => {
    expect(await send({ Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' })).toBe(200);
  });
});
