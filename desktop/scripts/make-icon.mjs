// Uygulama ikonunu (yeşil kare + ses dalgası çubukları) bağımlılıksız olarak PNG'ye çizer.
// electron-builder bu 512x512 PNG'den Windows .ico dosyasını üretir.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 512;
const SS = 4; // kenar yumuşatma için piksel başına SS×SS örnek
const BG = [0x1e, 0xd7, 0x60];
const FG = [0x0b, 0x0b, 0x0c];

// favicon.svg ile aynı geometri (32 birimlik tuval)
const unit = SIZE / 32;
const RADIUS = 8 * unit;
const BAR_HALF_WIDTH = 1.3 * unit;
const BARS = [
  [8, 13, 19],
  [12.7, 9, 23],
  [17.3, 11.5, 20.5],
  [22, 7.5, 24.5],
  [26, 13.5, 18.5],
].map(([x, y1, y2]) => [x * unit, y1 * unit, y2 * unit]);

function insideRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

function insideBar(x, y) {
  return BARS.some(([bx, y1, y2]) => {
    const cy = Math.min(Math.max(y, y1), y2); // yuvarlak uçlu çizgi = kapsül
    return (x - bx) ** 2 + (y - cy) ** 2 <= BAR_HALF_WIDTH ** 2;
  });
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let bg = 0;
    let fg = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS;
        const y = py + (sy + 0.5) / SS;
        if (!insideRoundedSquare(x, y)) continue;
        if (insideBar(x, y)) fg++;
        else bg++;
      }
    }
    const covered = bg + fg;
    const i = (py * SIZE + px) * 4;
    if (covered === 0) continue;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round((BG[c] * bg + FG[c] * fg) / covered);
    rgba[i + 3] = Math.round((covered / (SS * SS)) * 255);
  }
}

// --- PNG kodlama ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit derinliği
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filtre: yok
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`ikon yazıldı: ${out} (${png.length} bayt)`);
