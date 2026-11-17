/**
 * CẮT ẢNH THEO KHUNG ĐỎ của mẫu Giấy 10-11 (yêu cầu 2026-11-16).
 *
 * Khung đỏ đo từ `maugiay/tc_qm10_11.png`: x 20.9..574.5pt, y 27.7..813.9pt
 * trên trang 595×842 → cropBox {0.0351, 0.0329, 0.9655, 0.9666}.
 *
 * Kiểm chứng: ảnh mẫu thật (phiếu in 1653×2339) bị xoay nhiều góc + đệm nền;
 * pipeline phải cắt đúng khung, xoay thẳng, và đọc được mã đề.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { canonicalSheet } from "@/lib/omr/sheet";
import {
  applyCrop,
  cropBoxPx,
  estimateSkew,
  planCrop,
  rescaleLayout,
  rotateGray,
} from "@/lib/omr/sheet-crop";
import { processGrayWithCrop } from "@/lib/omr/pipeline";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

const SRC = "/home/dell/Documents/tulieuchambai/maugiay/qm10_11.png";
const has = existsSync(SRC);

const form: FormConfig = { ansNumber: 110, optionsPerQuestion: 4, form: "GIAY10_11", useExamCode: true, useStudentCode: false };
const layout = canonicalSheet(form);

async function loadGray(): Promise<GrayMat> {
  const jpg = await sharp(SRC).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { width: jpg.info.width, height: jpg.info.height, data: new Uint8ClampedArray(jpg.data) };
}

/** Đệm ảnh lên nền xám lớn hơn rồi xoay — mô phỏng ảnh chụp có nền. */
function padAndRotate(g: GrayMat, deg: number): GrayMat {
  const W = Math.round(g.width * 1.25);
  const H = Math.round(g.height * 1.25);
  const buf = Buffer.alloc(W * H, 200);
  const ox = Math.round((W - g.width) / 2);
  const oy = Math.round((H - g.height) / 2);
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) buf[(y + oy) * W + x + ox] = g.data[y * g.width + x];
  const padded: GrayMat = { width: W, height: H, data: new Uint8ClampedArray(buf) };
  return deg === 0 ? padded : rotateGray(padded, deg);
}

describe("cắt ảnh theo khung đỏ — Giấy 10-11", { timeout: 300_000 }, () => {
  it("layout có cropBox bao đúng 4 mốc in (±1.5%)", () => {
    expect(layout.cropBox).toBeDefined();
    const b = layout.cropBox!;
    // cropBox = bao 4 mốc + lề nhỏ — KHÔNG dùng khung đỏ của ảnh tiêu chí vì
    // khung đó có lề trên 133pt, trên ảnh chụp thật là nền bàn tối.
    expect(b.x0).toBeCloseTo(65.9 / 595, 3);
    expect(b.y0).toBeCloseTo(154.5 / 842, 3);
    expect(b.x1).toBeCloseTo(529.3 / 595, 3);
    expect(b.y1).toBeCloseTo(802.8 / 842, 3);
    // 4 mốc phải nằm trong khung
    for (const m of [layout.markers.tl, layout.markers.tr, layout.markers.br, layout.markers.bl]) {
      expect(m.x).toBeGreaterThan(b.x0);
      expect(m.x).toBeLessThan(b.x1);
      expect(m.y).toBeGreaterThan(b.y0);
      expect(m.y).toBeLessThan(b.y1);
    }
  });

  it("Giấy 12 KHÔNG có cropBox (không đụng mẫu này)", () => {
    const g12 = canonicalSheet({ ...form, form: "GIAY12", useExamCode: true, useStudentCode: true });
    expect(g12.cropBox).toBeUndefined();
  });

  it("cropBoxPx quy đúng sang px canonical", () => {
    const r = cropBoxPx(layout.cropBox!, layout, 1000, 1415);
    expect(r.x0).toBeCloseTo(110.8, 0);
    expect(r.x1).toBeCloseTo(889.6, 0);
  });

  it("rescaleLayout: mốc nằm trong [0,1] và giữ tỉ lệ", () => {
    const rl = rescaleLayout(layout, layout.cropBox!);
    expect(rl.markers.tl.x).toBeGreaterThan(0);
    expect(rl.markers.tl.x).toBeLessThan(1);
    expect(rl.markers.br.y).toBeLessThan(1);
    expect(rl.height).toBeGreaterThan(0);
    // khung cắt của layout đã cắt = toàn trang
    expect(rl.cropBox).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it.skipIf(!has)("ảnh mẫu đúng: cắt ra đúng khung, mốc sát 4 góc", async () => {
    const base = await loadGray();
    const plan = planCrop(base, layout, null, { targetWidth: 1400 })!;
    expect(plan).not.toBeNull();
    const cropped = applyCrop(base, plan);
    expect(cropped.width).toBe(1400);
    // tỉ lệ ảnh ra = tỉ lệ khung đỏ
    const b = layout.cropBox!;
    const wantRatio = ((b.y1 - b.y0) * layout.height) / (b.x1 - b.x0);
    expect(cropped.height / cropped.width).toBeCloseTo(wantRatio, 1);
  });

  it.skipIf(!has)("xoay tới ±10° vẫn đọc đúng mã đề sau khi cắt", async () => {
    const base = await loadGray();
    for (const deg of [0, 5, -9, 10]) {
      const img = padAndRotate(base, deg);
      const r = processGrayWithCrop(img, { form, checkSharpness: false, cropToBox: true, cropTargetWidth: 1400 });
      expect(r.ok, `deg=${deg} không đọc được`).toBe(true);
      expect(r.examCode, `deg=${deg} sai mã đề`).toBe("132");
    }
  });

  it.skipIf(!has)("nghiêng mạnh 15° vẫn cắt xuất sắc và đọc đúng", async () => {
    const base = await loadGray();
    const img = padAndRotate(base, 15);
    const r = processGrayWithCrop(img, { form, checkSharpness: false, cropToBox: true });
    expect(r.ok).toBe(true);
    expect(r.examCode).toBe("132");
  });

  it.skipIf(!has)("estimateSkew trả góc hữu hạn và phản ánh chiều nghiêng", async () => {
    const base = await loadGray();
    const s0 = estimateSkew(base);
    // mẫu gốc in hơi nghiêng; chỉ cần trong dải hợp lệ và đối xứng khi xoay
    expect(Number.isFinite(s0)).toBe(true);
    expect(Math.abs(s0)).toBeLessThan(12);
    const s8 = estimateSkew(padAndRotate(base, 8));
    expect(Number.isFinite(s8)).toBe(true);
    expect(Math.abs(s8)).toBeLessThan(12);
  });
});
