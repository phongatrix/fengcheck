/**
 * Generate the PWA icons (PNG) without external image tooling.
 * Draws a brand-blue rounded tile with a white checkmark, at 192 and 512 px.
 * Usage: node scripts/gen-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Minimal PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // no filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Icon drawing -----------------------------------------------------------
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * 0.18; // corner radius
  const bg = [36, 86, 217]; // brand-600
  const bgLight = [59, 110, 246];

  const insideRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= r && x <= size - r) || (y >= r && y <= size - r);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!insideRounded(x, y)) {
        rgba[i + 3] = 0;
        continue;
      }
      // subtle vertical gradient
      const t = y / size;
      rgba[i] = Math.round(bg[0] + (bgLight[0] - bg[0]) * t);
      rgba[i + 1] = Math.round(bg[1] + (bgLight[1] - bg[1]) * t);
      rgba[i + 2] = Math.round(bg[2] + (bgLight[2] - bg[2]) * t);
      rgba[i + 3] = 255;

      // white checkmark
      const u = x / size;
      const v = y / size;
      const onStroke =
        (u > 0.24 && u < 0.44 && Math.abs(v - (0.28 + (u - 0.24) * 2.1)) < 0.045) ||
        (u >= 0.44 && u < 0.78 && Math.abs(v - (0.84 - (u - 0.44) * 1.15)) < 0.045);
      if (onStroke) {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
      }
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), drawIcon(size));
  console.log(`wrote public/icons/icon-${size}.png`);
}
