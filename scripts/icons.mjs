import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal PNG encoder — enough for flat-colour PWA icons with no image dependencies. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function roundedRect(rgba, size, x0, y0, x1, y1, radius, color) {
  for (let y = Math.max(0, y0); y < Math.min(size, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x += 1) {
      const cx = Math.min(Math.max(x, x0 + radius), x1 - radius - 1);
      const cy = Math.min(Math.max(y, y0 + radius), y1 - radius - 1);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = color[3] ?? 255;
      }
    }
  }
}

function makeIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = maskable ? Math.round(size * 0.12) : 0;
  const radius = maskable ? Math.round(size * 0.16) : Math.round(size * 0.22);
  // Base tile: deep ink, matching the sidebar.
  roundedRect(rgba, size, 0, 0, size, size, radius, [11, 18, 32]);
  const inner = size - pad * 2;
  const mark = Math.round(inner * 0.16);
  const left = pad + Math.round(inner * 0.26);
  const top = pad + Math.round(inner * 0.24);
  const barH = Math.round(inner * 0.09);
  const gap = Math.round(inner * 0.09);
  // Three ledger lines of decreasing width, in brand teal.
  const widths = [0.48, 0.36, 0.24];
  widths.forEach((w, i) => {
    roundedRect(rgba, size, left, top + i * (barH + gap), left + Math.round(inner * w), top + i * (barH + gap) + barH, Math.round(barH / 2), [33, 179, 156]);
  });
  // Accent dot, balancing the mark.
  const dot = Math.round(inner * 0.1);
  roundedRect(
    rgba, size,
    pad + Math.round(inner * 0.68), pad + Math.round(inner * 0.2),
    pad + Math.round(inner * 0.68) + dot, pad + Math.round(inner * 0.2) + dot,
    Math.round(dot / 2), [255, 255, 255],
  );
  return encodePng(size, size, rgba);
}

export function generateIcons(outDir) {
  const targets = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    ['icon-maskable-512.png', 512, { maskable: true }],
    ['apple-touch-icon.png', 180, {}],
    ['favicon-64.png', 64, {}],
  ];
  for (const [name, size, opts] of targets) {
    writeFileSync(join(outDir, name), makeIcon(size, opts));
  }
  return targets.map(([name]) => name);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const dir = process.argv[2] ?? 'web/dist';
  console.log(generateIcons(dir));
}
