/**
 * KHÔNG vẽ vòng khoanh NGOÀI VÙNG ĐÁP ÁN (yêu cầu 2026-11-17).
 *
 * Hai lớp bảo vệ:
 *  1. Cổng BIÊN ĐỘ SHIFT: `q.center` (tâm snap được) lệch quá 1.2×bán kính ô
 *     so với vị trí layout → bỏ shift, dùng toạ độ layout. Snap dựa trên
 *     centroid mực nên ô trống/lưới lệch có thể trôi rất xa; shift đó áp cho
 *     CẢ HÀNG làm vòng vẽ lạc (đo ảnh người dùng: lệch 13.7–20.2px, dx hệ
 *     thống ±0.4–0.6%).
 *  2. Cổng BIÊN VÙNG ĐÁP ÁN: bao mọi bubble của layout (+1.6 bán kính), vòng
 *     có tâm ngoài bao này KHÔNG vẽ — tránh vòng vô nghĩa ở lề / khối điểm /
 *     mã đề / SBD.
 */
import { describe, expect, it } from "vitest";
import { annotateSheet } from "@/lib/omr/reader";
import { canonicalSheet } from "@/lib/omr/sheet";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { processGray } from "@/lib/omr/pipeline";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import type { FormConfig } from "@/lib/omr/types";

function makeForm(): FormConfig {
  const base: FormConfig = { ansNumber: 0, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true };
  base.ansNumber = layoutQuestionCount(canonicalSheet(base));
  return base;
}

describe("vòng khoanh không ra ngoài vùng đáp án", { timeout: 300_000 }, () => {
  const form = makeForm();
  const layout = canonicalSheet(form);

  it("ảnh render đầy đủ: mọi pixel xanh lục nằm trong bao vùng đáp án", () => {
    const signBase = layoutQuestionCount(layout);
    const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
      if (i < layout.part1Count) return i % 4;
      if (i < layout.questions.length) return i % 2;
      if (i < signBase) return (i * 7) % 10;
      return -1;
    });
    const gray = renderSheetToGray({ form, answers, examCode: "2109", studentCode: "50120376", paperWidth: 1600 });
    const res = processGray(gray, { form, checkSharpness: false });
    const W = 1000;
    const H = Math.round(W / (layout.width / layout.height));
    const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
    const out = annotateSheet(
      rgba, W, H, layout,
      (res.questions ?? []).map((q) => ({ index: q.index, answer: q.answer, scores: q.scores, unsure: q.unsure })),
      answers, null, res.part3, res.examCode, res.studentCode, res.part3Signs,
      { width: W, height: H },
    );
    const all = [
      ...layout.questions.flatMap((q) => q.bubbles),
      ...layout.part3.flatMap((q) => q.columns.flatMap((c) => c.bubbles)),
    ];
    const padR = all[0].r * Math.min(W, H) * 2;
    const x0 = Math.min(...all.map((b) => b.x * W)) - padR;
    const x1 = Math.max(...all.map((b) => b.x * W)) + padR;
    const y0 = Math.min(...all.map((b) => b.y * H)) - padR;
    const y1 = Math.max(...all.map((b) => b.y * H)) + padR;
    let outside = 0;
    let inside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = out[i];
        const g = out[i + 1];
        const b = out[i + 2];
        if (!(g > 110 && g - r > 40 && g - b > 40)) continue; // chỉ xét xanh lục
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inside++;
        else outside++;
      }
    }
    expect(inside).toBeGreaterThan(5000); // vẫn vẽ đủ vòng
    expect(outside).toBe(0); // KHÔNG vòng nào ra ngoài
  });

  it("cổng biên độ shift: tâm snap lệch xa → vẫn vẽ tại toạ độ layout", () => {
    const q = layout.questions[0];
    const W = 1000;
    const H = Math.round(W / (layout.width / layout.height));
    const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
    // tâm "snap" bị trôi 30% chiều rộng (snap hỏng điển hình)
    const badCenter = { x: q.bubbles[0].x * W + W * 0.3, y: q.bubbles[0].y * H };
    // key phải phủ ĐỦ số ô của layout để nhánh vẽ vòng học sinh chạy
    const nSlots = layout.questions.length + layout.part3.reduce((s, p) => s + p.columns.length * 4, 0);
    const key = new Array(nSlots).fill(-1);
    key[0] = 0; // đáp án câu 1 = A
    const out = annotateSheet(
      rgba, W, H, layout,
      [{ index: 0, answer: 0, scores: [1, 0, 0, 0], unsure: false, center: badCenter }],
      key, null, undefined, null, null, undefined,
      { width: W, height: H },
    );
    // vòng phải vẽ tại ô layout (bubble 0), KHÔNG tại vị trí trôi.
    // Quét bán kính ±(2r) để bắt trọn vành vòng (r ≈ 2.5% cạnh).
    const rPx = Math.round(q.bubbles[0].r * Math.min(W, H) * 2);
    const ringNear = (bx: number, by: number) => {
      const cx = Math.round(bx * W);
      const cy = Math.round(by * H);
      for (let dy = -rPx; dy <= rPx; dy++) {
        for (let dx = -rPx; dx <= rPx; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = (y * W + x) * 4;
          const r = out[i];
          const g = out[i + 1];
          const b = out[i + 2];
          if (g > 110 && g - r > 40 && g - b > 40) return true;
        }
      }
      return false;
    };
    expect(ringNear(q.bubbles[0].x, q.bubbles[0].y)).toBe(true); // có vòng đúng ô
    expect(ringNear(badCenter.x / W, badCenter.y / H)).toBe(false); // không vòng ở chỗ trôi
  });
});

describe("vòng lạc trong KHOẢNG TRỐNG giữa các phần", { timeout: 300_000 }, () => {
  const form: FormConfig = { ansNumber: 96, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true };
  const layout = canonicalSheet(form);
  const W = 1000;
  const H = Math.round(W / (layout.width / layout.height));

  it("3 vòng dư của ảnh báo cáo (y=33.6%, x=49.5..53.9%) bị chặn", () => {
    const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
    // Mô phỏng vòng lạc: center lệch 8.7×r khỏi ô gần nhất (đo được trên ảnh)
    const stray = { x: 0.517 * W, y: 0.336 * H };
    const nSlots = layout.questions.length + layout.part3.reduce((s, p) => s + p.columns.length * 4, 0);
    const out = annotateSheet(
      rgba, W, H, layout,
      [{ index: 0, answer: 0, scores: [1, 0, 0, 0], unsure: false, center: stray }],
      new Array(nSlots).fill(-1), null, undefined, null, null, undefined,
      { width: W, height: H },
    );
    const countNear = (cx: number, cy: number, rad: number) => {
      let n = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const x = Math.round(cx + dx);
          const y = Math.round(cy + dy);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = (y * W + x) * 4;
          const r = out[i];
          const g = out[i + 1];
          const b = out[i + 2];
          if ((g > 110 && g - r > 40 && g - b > 40) || (r > 150 && g < 90 && b < 90)) n++;
        }
      }
      return n;
    };
    // vòng đúng ô layout vẫn vẽ
    const q = layout.questions[0].bubbles[0];
    expect(countNear(q.x * W, q.y * H, 25)).toBeGreaterThan(0);
    // vị trí lạc (khoảng trống header→P1, giữa khối cột 2/3) KHÔNG có vòng
    expect(countNear(stray.x, stray.y, 25)).toBe(0);
  });
});
