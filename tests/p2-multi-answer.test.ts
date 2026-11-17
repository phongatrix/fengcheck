/**
 * PHẦN II — học sinh TÔ NHIỀU ĐÁP ÁN trong cùng một ý (cả Đ và S).
 *
 * Bộ đọc phải trả -2 (multi) để KHÔNG cộng điểm cho ý đó, và ảnh kết quả phải
 * KHOANH CAM mọi ô học sinh đã tô (yêu cầu 2026-11-17) — trước đây không vẽ gì
 * (nhìn như bỏ trống) và lại vẽ vòng vàng "bỏ trống" ở ô đáp án.
 */
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processGray, renderScoredPreview } from "@/lib/omr/pipeline";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import { gradeGiay, parsePartMaxes } from "@/lib/scoring";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

function makeForm(): FormConfig {
  const base: FormConfig = { ansNumber: 0, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true };
  base.ansNumber = layoutQuestionCount(canonicalSheet(base));
  return base;
}

/** Tô đậm một bubble trong ảnh render (mô phỏng học sinh tô thêm đáp án thứ 2). */
function paintBubble(gray: GrayMat, bx: number, by: number, br: number) {
  const { width: W, height: H } = gray;
  const minSide = Math.min(W, H);
  const cx = bx * W;
  const cy = by * H;
  const r = br * minSide;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r * 0.85) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x >= 0 && y >= 0 && x < W && y < H) gray.data[y * W + x] = 22;
    }
  }
}

describe("PHẦN II — tô nhiều đáp án trong cùng một ý", { timeout: 300_000 }, () => {
  const form = makeForm();
  const layout = canonicalSheet(form);
  const signBase = layoutQuestionCount(layout);
  const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
    if (i < layout.part1Count) return i % 4;
    if (i < layout.questions.length) return i % 2;
    if (i < signBase) return (i * 7) % 10;
    return -1;
  });

  it("tô cả Đ và S → answer = -2, ý đó không được điểm", () => {
    const gray = renderSheetToGray({ form, answers, examCode: "1132", paperWidth: 1600 });
    const qIdx = layout.part1Count; // PHẦN II câu 1, ý a
    const b = layout.questions[qIdx].bubbles;
    paintBubble(gray, b[1].x, b[1].y, b[1].r); // tô thêm S (Đ đã có từ render)
    const res = processGray(gray, { form, checkSharpness: false });
    const q = res.questions?.find((x) => x.index === qIdx);
    expect(q?.answer).toBe(-2);
    expect(q?.unsure).toBe(true);
    // 2 ô đều đậm → scores cả hai ≥ ngưỡng
    expect((q?.scores ?? []).filter((s) => s > 0.3).length).toBeGreaterThanOrEqual(2);

    // Chấm: ý a của câu 1 bị coi là SAI (không cộng điểm)
    const key = [...answers];
    const g = gradeGiay(
      { p1: layout.part1Count, p2: Math.floor(layout.part2Count / 4), p3: layout.part3.length },
      key,
      res.answers ?? [],
      parsePartMaxes("10,8,3"),
    );
    // Đúng hết trừ 1 ý tô kép → tổng điểm thấp hơn mức tối đa
    expect(g.text).toContain("P2:");
    const maxTotal = parsePartMaxes("10,8,3");
    expect(g.totalScore).toBeLessThan(maxTotal.p1 + maxTotal.p2 + maxTotal.p3);
    // cụ thể: dòng P2 không phải "8/8" cho mọi nhóm (có 1 ý bị loại)
    const p2Line = g.lines.find((l) => l.startsWith("P2:")) ?? "";
    expect(p2Line).not.toContain("0/8");
  });

  it("ảnh kết quả khoanh CAM cả 2 ô tô kép, KHÔNG vẽ vàng bỏ trống", () => {
    const gray = renderSheetToGray({ form, answers, examCode: "1132", paperWidth: 1600 });
    const qIdx = layout.part1Count;
    const b = layout.questions[qIdx].bubbles;
    paintBubble(gray, b[1].x, b[1].y, b[1].r);
    const res = processGray(gray, { form, checkSharpness: false });
    const prev = renderScoredPreview(res, null, [...answers]);
    expect(prev).toBeDefined();
    const P = prev!.rgba;
    let orange = 0;
    let yellow = 0;
    for (let i = 0; i < P.length; i += 4) {
      const r = P[i];
      const g = P[i + 1];
      const bl = P[i + 2];
      if (r > 200 && g > 60 && g < 130 && bl < 60) orange++;
      else if (r > 200 && g > 160 && bl < 80) yellow++;
    }
    expect(orange).toBeGreaterThan(200); // vẽ vòng cam trên 2 ô
    expect(yellow).toBe(0); // không vẽ vàng giả "bỏ trống"
  });

  it("PHẦN I tô 2 phương án → cũng -2 và khoanh cam", () => {
    const gray = renderSheetToGray({ form, answers, examCode: "1132", paperWidth: 1600 });
    const qIdx = 0;
    const b = layout.questions[qIdx].bubbles;
    paintBubble(gray, b[1].x, b[1].y, b[1].r); // câu 1 đã tô A, tô thêm B
    const res = processGray(gray, { form, checkSharpness: false });
    const q = res.questions?.find((x) => x.index === qIdx);
    expect(q?.answer).toBe(-2);
  });
});
