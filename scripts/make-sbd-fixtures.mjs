/**
 * Cắt ảnh chụp thật (Thu/12a7) thành fixture .gray/.meta.json cho
 * tests/sbd-real.test.ts — test không phụ thuộc sharp/PIL.
 *
 *   node scripts/make-sbd-fixtures.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const CASES = [
  ["IMG_20261106_090756", "real-qma4-a"],
  ["IMG_20261106_090802", "real-qma4-b"],
  ["IMG_20261106_090823", "real-qma4-c"],
];
const SRC = "/home/dell/Documents/tulieuchambai/Thu/12a7";

for (const [src, out] of CASES) {
  const { data, info } = await sharp(`${SRC}/${src}.jpg`)
    .rotate()
    .resize({ width: 1600 })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  writeFileSync(`tests/fixtures/${out}.gray`, data);
  writeFileSync(`tests/fixtures/${out}.meta.json`, JSON.stringify({ w: info.width, h: info.height }));
  console.log(out, info.width, info.height);
}
