/**
 * TIỀN XỬ LÝ ẢNH — khoá hành vi từng bước (yêu cầu 2026-11-17).
 *
 * Ba lớp lỗi thực đo trên ảnh người dùng:
 *  1. ẢNH NGHIÊNG NHẸ: warp lệch dần → câu cuối lệch lưới 10px.
 *  2. DẢI ĐEN/VIỀN ở mép: blob detector bắt nhầm thành mốc → warp cả trang sai
 *     (tỉ lệ quad 1.03 thay vì 1.40).
 *  3. NỘI DUNG CHẠM MÉP: không còn lề để dò vòng/mốc.
 */
import { describe, expect, it } from "vitest";
import { autoDeskew, ensureMargins, preprocessUpload, rotateGrayFast, trimBlackBands } from "@/lib/omr/preprocess";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

/** Phiếu Giấy 12 tô sẵn để làm nền thử. */
function sheet(opts: { paperWidth?: number } = {}): GrayMat {
  const form: FormConfig = {
    ansNumber: 0,
    optionsPerQuestion: 4,
    form: "GIAY12",
    useExamCode: true,
    useStudentCode: true,
  };
  const layout = canonicalSheet({ ...form });
  form.ansNumber = layoutQuestionCount(layout);
  const signBase = layoutQuestionCount(layout);
  const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
    if (i < layout.part1Count) return i % 4;
    if (i < layout.questions.length) return i % 2;
    if (i < signBase) return (i * 7) % 10;
    return -1;
  });
  return renderSheetToGray({ form, answers, examCode: "1132", paperWidth: opts.paperWidth ?? 1400 });
}

/** Đệm nền xám quanh phiếu (mô phỏng ảnh chụp có lề nền). */
function padWith(g: GrayMat, ratio: number, value = 200): GrayMat {
  const px = Math.round(g.width * ratio);
  const py = Math.round(g.height * ratio);
  const W = g.width + px * 2;
  const H = g.height + py * 2;
  const out = new Uint8ClampedArray(W * H).fill(value);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) out[(y + py) * W + (x + px)] = g.data[y * g.width + x];
  }
  return { width: W, height: H, data: out };
}

/** Đệm DẢI ĐEN ở mép trên/dưới (26px) — mô phỏng dải đen trong ảnh lỗi. */
function addBlackBands(g: GrayMat, band: number): GrayMat {
  const W = g.width;
  const H = g.height + band * 2;
  const out = new Uint8ClampedArray(W * H).fill(255);
  out.fill(12, 0, W * band);
  out.fill(12, W * (H - band), W * H);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < W; x++) out[(y + band) * W + x] = g.data[y * W + x];
  }
  return { width: W, height: H, data: out };
}

const rowMean = (g: GrayMat, y: number) => {
  let s = 0;
  for (let x = 0; x < g.width; x++) s += g.data[y * g.width + x];
  return s / g.width;
};

describe("tiền xử lý ảnh trước khi chấm", { timeout: 300_000 }, () => {
  it("trimBlackBands cắt dải đen trên/dưới và đệm lề trắng", () => {
    const base = sheet({ paperWidth: 1200 });
    const withBands = addBlackBands(base, 26);
    expect(rowMean(withBands, 5)).toBeLessThan(30); // có dải đen
    const trimmed = trimBlackBands(withBands);
    expect(trimmed).not.toBe(withBands);
    // dải đen đã biến mất: mọi hàng không còn tối đều
    expect(rowMean(trimmed, 3)).toBeGreaterThan(180);
    expect(rowMean(trimmed, trimmed.height - 4)).toBeGreaterThan(180);
    // Kích thước = phiếu gốc + lề 2% mỗi phía (dải đen đã bị cắt, cộng lề mới)
    // Cắt dải đen + đệm lề 2% quanh VÙNG NỘI DUNG: cao hơn phiếu trắng gốc một
    // chút (lề mới) nhưng dải đen đã mất (kiểm bằng rowMean ở trên).
    expect(trimmed.width).toBeGreaterThan(base.width);
    expect(trimmed.width).toBeLessThan(base.width * 1.10);
    expect(trimmed.height).toBeGreaterThan(base.height);
  });

  it("trimBlackBands KHÔNG đổi ảnh sạch (không có dải đen)", () => {
    const clean = padWith(sheet({ paperWidth: 1200 }), 0.05, 235);
    expect(trimBlackBands(clean)).toBe(clean);
  });

  it("autoDeskew phát hiện và sửa ảnh nghiêng 1.5°", () => {
    const straight = padWith(sheet({ paperWidth: 1200 }), 0.06, 235);
    const skewed = rotateGrayFast(straight, 1.5);
    const res = autoDeskew(skewed);
    // phải phát hiện nghiêng và xoay NGƯỢC chiều
    expect(Math.abs(res.deg)).toBeGreaterThan(0.8);
    expect(res.deg).toBeLessThan(0); // xoay -1.5 để sửa +1.5
    expect(res.image).not.toBe(skewed);
  });

  it("autoDeskew không xoay ảnh vốn thẳng", () => {
    const straight = padWith(sheet({ paperWidth: 1200 }), 0.06, 235);
    const res = autoDeskew(straight);
    expect(res.deg).toBe(0);
    expect(res.image).toBe(straight);
  });

  it("ensureMargins đệm lề khi mực chạm mép", () => {
    // Phiếu render vẫn có lề trắng sẵn → cắt sát nội dung trước để mô phỏng
    // ảnh bị crop sát mép giấy (mực chạm rìa).
    const full = sheet({ paperWidth: 1000 });
    const crop = 0.10; // bỏ 10% rìa mỗi phía như ảnh crop sát
    const cw = Math.round(full.width * (1 - crop * 2));
    const chh = Math.round(full.height * (1 - crop * 2));
    const ox = Math.round(full.width * crop);
    const oy = Math.round(full.height * crop);
    const data = new Uint8ClampedArray(cw * chh);
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) data[y * cw + x] = full.data[(y + oy) * full.width + (x + ox)];
    const g: GrayMat = { width: cw, height: chh, data };
    const out = ensureMargins(g);
    expect(out).not.toBe(g);
    expect(out.width).toBeGreaterThan(g.width);
    expect(out.height).toBeGreaterThan(g.height);
    // góc ảnh mới phải là nền trắng
    expect(out.data[0]).toBe(255);
    expect(out.data[out.width * out.height - 1]).toBe(255);
  });

  it("ensureMargins không đệm khi đã có lề", () => {
    const padded = padWith(sheet({ paperWidth: 1000 }), 0.06, 235);
    expect(ensureMargins(padded)).toBe(padded);
  });

  it("preprocessUpload trả góc xoay + cờ cắt cho UI", () => {
    const withBands = addBlackBands(rotateGrayFast(padWith(sheet({ paperWidth: 1200 }), 0.05, 235), 1.2), 20);
    const pre = preprocessUpload(withBands);
    expect(pre.trimmed).toBe(true);
    expect(Math.abs(pre.skewDeg)).toBeGreaterThan(0.5);
    expect(rowMean(pre.image, 3)).toBeGreaterThan(180); // dải đen đã cắt
  });

  it("preprocessUpload trên ảnh sạch không thay đổi nội dung đáng kể", () => {
    const clean = padWith(sheet({ paperWidth: 1200 }), 0.06, 235);
    const pre = preprocessUpload(clean);
    expect(pre.skewDeg).toBe(0);
    expect(pre.trimmed).toBe(false);
    expect(pre.image.width).toBe(clean.width);
    expect(pre.image.height).toBe(clean.height);
  });
});
