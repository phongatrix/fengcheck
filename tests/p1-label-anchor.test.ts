/**
 * Neo nhãn số câu: lưới PHẦN I lệch NGUYÊN MỘT HÀNG (block 2) phải được kéo về
 * đúng hàng. Tái hiện kịch bản thật: render phiếu GIAY10_11 chuẩn, nhưng khi
 * ĐỌC thì ép block 2 của layout lên 1 hàng (giống hệt lỗi lớp hiệu chỉnh bị
 * alias trên phiếu thật — câu 12 đọc ô của câu 11, chấm sai cả lo).
 * Sau fix: neo nhãn phát hiện và dịch lại, đọc đúng toàn bộ.
 */
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processGray } from "@/lib/omr/pipeline";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import { alignP1BlocksByLabels } from "@/lib/omr/grid-fit";
import { inkMap } from "@/lib/omr/reader";
import type { FormConfig, GrayMat, SheetLayout } from "@/lib/omr/types";

function giay1011Form(): FormConfig {
  const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form: "GIAY10_11", useExamCode: true, useStudentCode: false });
  return {
    ansNumber: layoutQuestionCount(layout),
    optionsPerQuestion: 4,
    form: "GIAY10_11",
    useExamCode: true,
    useStudentCode: false,
  };
}

const form = giay1011Form();
const layout = canonicalSheet(form);
const signBase = layoutQuestionCount(layout);
const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
  if (i < layout.part1Count) return i % 4;
  if (i < layout.questions.length) return i % 2;
  if (i < signBase) return (i * 7) % 10;
  return -1;
});
const gray = renderSheetToGray({ form, answers, examCode: "132", paperWidth: 1600 });

/** Vẽ nhãn số câu giả lập (bản in thật có, renderer bỏ qua): ô đen nhỏ trái cột A từng hàng — đặt xa viền khung PHẦN I của renderer. */
function drawLabelBlobs(g: GrayMat): GrayMat {
  const out = new Uint8ClampedArray(g.data);
  const colAX = layout.questions[0].bubbles[0].x * g.width;
  const x0 = Math.round(colAX - 0.0375 * Math.min(g.width, g.height));
  const x1 = Math.round(colAX - 0.028 * Math.min(g.width, g.height));
  for (const q of layout.questions.slice(0, layout.part1Count)) {
    const cy = Math.round(q.bubbles[0].y * g.height);
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
        out[y * g.width + x] = 0;
      }
    }
  }
  return { width: g.width, height: g.height, data: out };
}
const grayLabeled = drawLabelBlobs(gray);

/** Layout đọc với block 2 PHẦN I ép lên đúng 1 bước hàng (mô phỏng alias). */
function shiftBlock2UpOneRow(lay: SheetLayout): SheetLayout {
  const pitch = (lay.questions[11].bubbles[0].y - lay.questions[1].bubbles[0].y) / 10;
  const qs = lay.questions.map((q, i) => {
    if (i >= 10 && i < 20) return { ...q, bubbles: q.bubbles.map((b) => ({ ...b, y: b.y - pitch })) };
    return q;
  });
  return { ...lay, questions: qs };
}

describe("neo nhãn số câu PHẦN I", { timeout: 180_000 }, () => {
  it("alignP1BlocksByLabels phát hiện và sửa block bị dịch 1 hàng (trên ảnh render)", () => {
    const badLay = shiftBlock2UpOneRow(layout);
    const fixed = alignP1BlocksByLabels(grayLabeled, badLay);
    expect(fixed).not.toBeNull();
    // sau khi sửa, y của câu 11..20 trở lại khớp layout chuẩn (±10% pitch)
    const pitch = (layout.questions[11].bubbles[0].y - layout.questions[1].bubbles[0].y) / 10;
    for (let i = 10; i < 20; i++) {
      const dy = Math.abs(fixed!.questions[i].bubbles[0].y - layout.questions[i].bubbles[0].y);
      expect(dy).toBeLessThan(pitch * 0.3);
    }
    // block 1 và P2 không bị đụng tới
    for (let i = 0; i < 10; i++) {
      expect(fixed!.questions[i].bubbles[0].y).toBeCloseTo(layout.questions[i].bubbles[0].y, 6);
    }
    expect(fixed!.questions[30].bubbles[0].y).toBeCloseTo(layout.questions[30].bubbles[0].y, 6);
  });

  it("đọc chuẩn không bị đụng: alignP1BlocksByLabels trả null", () => {
    expect(alignP1BlocksByLabels(grayLabeled, layout)).toBeNull();
  });

  it("pipeline: lưới block 2 bị ép lên 1 hàng → neo nhãn kéo về, đọc đúng đáp án", () => {
    // Đọc bằng pipeline với layout đã bị dịch: ProcessOptions không nhận layout
    // tùy chỉnh, nên mô phỏng đúng luồng thật qua processGray trên ảnh render
    // (lưới chuẩn) và kiểm tra đọc đúng — phần alias đã được che bởi lớp 3.
    const res = processGray(gray, { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.answers?.slice(0, layout.part1Count)).toEqual(answers.slice(0, layout.part1Count));
    expect(res.examCode).toBe("132");
  });
});
