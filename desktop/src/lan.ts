// Wi-Fi ile telefona gönderme: uygulama aynı ağdaki cihazlara da (telefon, tablet, başka bilgisayar)
// hizmet verir. Yalnızca QR koddaki gizli anahtarla gelen cihaz girebilir; anahtar her açılışta
// yenilenir. Telefondan silme / klasör düzenleme gibi yıkıcı işlemler kapalıdır.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

export const LAN_PORT = 47822;
const COOKIE = 'flacsync_lan';

/** Telefondan yapılamayan işlemler */
const BLOCKED: Array<[string, RegExp]> = [
  ['DELETE', /^\/api\/library\/tracks\/[^/]+\/file/],
  ['POST', /^\/api\/library\/organize\/apply/],
  ['DELETE', /^\/api\/history/],
];

export interface LanStatus {
  enabled: boolean;
  url: string | null;
  qr: string | null;
  addresses: string[];
  error: string | null;
}

/** Ev / ofis ağındaki IPv4 adresleri (önce 192.168, 10., 172.16-31) */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookieValue(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(header);
  return m?.[1] ?? null;
}

export class LanShare {
  private server: Server | null = null;
  private token = '';
  private status: LanStatus = { enabled: false, url: null, qr: null, addresses: [], error: null };

  constructor(private readonly handler: RequestListener) {}

  get current(): LanStatus {
    return this.status;
  }

  async enable(): Promise<LanStatus> {
    if (this.server) return this.status;
    this.token = randomBytes(18).toString('base64url');
    const server = createServer((req, res) => this.handle(req, res));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(LAN_PORT, '0.0.0.0', () => resolve());
      });
    } catch (err) {
      this.status = { ...this.status, enabled: false, error: err instanceof Error ? err.message : String(err) };
      return this.status;
    }
    this.server = server;
    const addresses = lanAddresses();
    const url = addresses[0] ? `http://${addresses[0]}:${LAN_PORT}/?key=${this.token}` : null;
    const qr = url ? await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#17151fff', light: '#ffffffff' } }) : null;
    this.status = { enabled: true, url, qr, addresses, error: addresses.length ? null : 'Ağ bağlantısı bulunamadı' };
    return this.status;
  }

  async disable(): Promise<LanStatus> {
    const server = this.server;
    this.server = null;
    this.token = '';
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.status = { enabled: false, url: null, qr: null, addresses: [], error: null };
    return this.status;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://lan');
    const key = url.searchParams.get('key');
    // QR'dan ilk giriş: anahtar çereze yazılır, adres çubuğundan silinir
    if (key) {
      if (!safeEqual(key, this.token)) return deny(res);
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE}=${this.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        Location: '/#/library',
      });
      res.end();
      return;
    }
    const cookie = cookieValue(req);
    if (!cookie || !safeEqual(cookie, this.token)) return deny(res);
    if (BLOCKED.some(([method, re]) => req.method === method && re.test(url.pathname))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Bu işlem yalnızca bilgisayardan yapılabilir' } }));
      return;
    }
    this.handler(req, res);
  }
}

function deny(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;background:#17151f;color:#efeaf6;padding:24px">' +
      '<h2>FlacSync</h2><p>Bağlanmak için bilgisayarda <b>Ayarlar → Telefona gönder</b> bölümündeki QR kodu okutun.</p>' +
      '<p>To connect, scan the QR code in <b>Settings → Send to phone</b> on your computer.</p></body>',
  );
}
