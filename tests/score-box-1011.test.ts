/**
 * Kiểm tra vị trí khối chữ đỏ trên preview của mẫu Giấy 10-11: chữ phải nằm
 * trong khung "Điểm bài kiểm tra" in sẵn and cỡ chữ phải bằng ~nửa khối cũ.
 *
 * Chạy: npx vitest run tests/score-box-1011.test.ts
 * Ghi ảnh /tmp/scorebox-1011.png để xem bằng mắt.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { it, expect } from "vitest";
import { processGray, renderScoredPreview } from "@/lib/omr/pipeline";
import { gradeGiay, parsePartMaxes } from "@/lib/scoring";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

const hasFixture = () => existsSync("tests/fixtures/scan-giay1011.meta.json");

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/scan-${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/scan-${name}.gray`);
  return {
    width: meta.w,
    height: meta.h,
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length),
  };
}

/** Nén RGBA thành PNG nhỏ để soi bằng mắt (không cần thư viện). */
function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray) {
  // PNG không nén (deflate store) — đủ để mở xem.
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

it("Giấy 10-11: khối điểm nằm trong khung Điểm bài kiểm tra, cỡ chữ nửa khối cũ", { skip: !hasFixture() }, () => {
  const form: FormConfig = {
    ansNumber: 110,
    optionsPerQuestion: 4,
    form: "GIAY10_11",
    useExamCode: true,
    useStudentCode: false,
  };
  const res = processGray(loadGray("giay1011"), { form, checkSharpness: false });
  expect(res.ok).toBe(true);
  const layout = res.layout;
  expect(layout.scoreBox).toBeDefined();

  const answers = res.answers ?? [];
  const key = Array.from({ length: 110 }, (_, i) =>
    i < 30 ? (i + 1) % 4 : i < 70 ? (i + 1) % 2 : (i * 7) % 10,
  );
  const grade = gradeGiay({ p1: 30, p2: 10, p3: 10 }, key, answers, parsePartMaxes("6,4,0"));
  console.log("grade:", grade.lines.join(" | "));

  // Render lại preview có điểm (đúng đường đi của worker).
  const preview = renderScoredPreview(res, grade.text, key);
  expect(preview).toBeDefined();
  const { width, height, rgba } = preview!;

  // Đo dải pixel đỏ (chữ kết quả).
  const isRed = (i: number) => rgba[i] > 150 && rgba[i + 1] < 90 && rgba[i + 2] < 90;
  const bands: { y0: number; y1: number; x0: number; x1: number; n: number }[] = [];
  let cur: (typeof bands)[number] | null = null;
  for (let y = 0; y < height; y++) {
    let n = 0;
    let minX = width;
    let maxX = -1;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isRed(i)) {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (n >= 3) {
      if (cur && y - cur.y1 <= 2) {
        cur.y1 = y;
        cur.x0 = Math.min(cur.x0, minX);
        cur.x1 = Math.max(cur.x1, maxX);
        cur.n += n;
      } else {
        cur = { y0: y, y1: y, x0: minX, x1: maxX, n };
        bands.push(cur);
      }
    } else cur = null;
  }

  writePng("/tmp/scorebox-1011.png", width, height, rgba);
  console.log(
    "bands:",
    bands.map((b) => `y ${b.y0}-${b.y1} x ${b.x0}-${b.x1} (${b.n}px)`).join(" | "),
  );

  const box = layout.scoreBox!;
  /**
   * Preview giờ là ẢNH GỐC, lưới được chiếu qua `res.toSource` (canonical →
   * ảnh chụp). Khung điểm kỳ vọng = bao của 4 góc khung (sau phép chiếu), nên
   * bài kiểm vẫn đo đúng "chữ nằm trong khung Điểm bài kiểm tra".
   */
  const cs = res.canonicalSize ?? { width: res.canonical!.width, height: res.canonical!.height };
  const mapPt = res.toSource ?? ((p: { x: number; y: number }) => p);
  const sx0 = Math.min(...box.slots.map((s) => s.x));
  const sx1 = Math.max(...box.slots.map((s) => s.maxX));
  const sy0 = Math.min(...box.slots.map((s) => s.y));
  const sy1 = Math.max(...box.slots.map((s) => s.y)) + 0.03;
  const corners = [
    { x: sx0, y: sy0 },
    { x: sx1, y: sy0 },
    { x: sx0, y: sy1 },
    { x: sx1, y: sy1 },
  ].map((c) => mapPt({ x: c.x * cs.width, y: c.y * cs.height }));
  const bx0 = Math.min(...corners.map((c) => c.x));
  const bx1 = Math.max(...corners.map((c) => c.x));
  const by0 = Math.min(...corners.map((c) => c.y));
  const by1 = Math.max(...corners.map((c) => c.y));
  console.log(`khung điểm (ảnh gốc): x ${bx0.toFixed(0)}-${bx1.toFixed(0)} y ${by0.toFixed(0)}-${by1.toFixed(0)} | preview ${width}x${height}`);

  // 1. Chữ kết quả phải nằm trong khung điểm (không tràn lên tiêu đề/ô Mã đề).
  //    Lề trái nới 6px vì glyph đậm có thể rộng hơn advance một chút.
  for (const b of bands) {
    expect(b.x0).toBeGreaterThanOrEqual(Math.floor(bx0) - 6);
    expect(b.x1).toBeLessThanOrEqual(Math.ceil(bx1) + 2);
    expect(b.y0).toBeGreaterThanOrEqual(Math.floor(by0) - 4);
    expect(b.y1).toBeLessThanOrEqual(Math.ceil(by1));
  }
  expect(bands.length).toBe(4);

  // 2. Hai cột: P1/P2 ở cột trái hàng trên, P3/Tong ở cột trái hàng dưới.
  expect(bands[1].y0).toBeGreaterThan(bands[0].y1);
  expect(bands[2].y0).toBeGreaterThan(bands[1].y1);
  expect(bands[3].y0).toBeGreaterThan(bands[2].y1);

  // 2. Cỡ chữ ~ nửa khối cũ (0.032H): chiều cao dải ≈ 0.016H (±30%).
  const hAvg = bands.reduce((s, b) => s + (b.y1 - b.y0 + 1), 0) / bands.length;
  console.log("band height avg:", hAvg.toFixed(1), "expected ≈", (height * 0.016).toFixed(1));
  expect(hAvg).toBeGreaterThan(height * 0.016 * 0.6);
  expect(hAvg).toBeLessThan(height * 0.016 * 1.6);
});
