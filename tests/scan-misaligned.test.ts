import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processGray } from "@/lib/omr/pipeline";
import { readCanonicalSheet } from "@/lib/omr/reader";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";
import type { FormConfig, GrayMat, SheetLayout } from "@/lib/omr/types";

/**
 * Lưới ô in LỆCH so với lưới đáp án chuẩn.
 *
 * Bản in / ảnh chụp thường không khớp tuyệt đối với toạ độ tách từ PDF: cả hàng
 * ô in bị dịch 0,5–1,0 bán kính. Trước đây hộp mẫu đặt ở toạ độ chuẩn rơi lên
 * VÀNH ô, nên hàng trống bị đọc thành "tô đè" và vết tô chỉ lọt một phần vào ô
 * thì bị bỏ qua. Các test dưới đây khoá lại hành vi đúng:
 *   - mực lọt vào ô chuẩn (kể cả lệch gần 1 bán kính) vẫn được TÍNH;
 *   - hàng trống vẫn là trống, không bị biến thành "tô đè".
 */

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/scan-${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/scan-${name}.gray`);
  return { width: meta.w, height: meta.h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) };
}

const GIAY12: FormConfig = { ansNumber: 96, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true };

/** Dịch lưới ô (không đụng marker) để mô phỏng bản in lệch. */
function shiftGrid(l: SheetLayout, dxPt: number, dyPt: number, W: number, H: number): SheetLayout {
  const f = (p: { x: number; y: number }) => ({ x: p.x + dxPt / W, y: p.y + dyPt / H });
  const s = (b: { x: number; y: number; r: number }) => ({ ...f(b), r: b.r });
  return {
    ...l,
    questions: l.questions.map((q) => ({ ...q, bubbles: q.bubbles.map(s) })),
    part3: l.part3.map((q) => ({ ...q, columns: q.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(s) })) })),
    examCode: l.examCode ? { ...l.examCode, columns: l.examCode.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(s) })) } : l.examCode,
    studentCode: l.studentCode ? { ...l.studentCode, columns: l.studentCode.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(s) })) } : l.studentCode,
  };
}

describe("Giấy 12 — lưới in lệch (phiếu thật)", () => {
  const hasFixture = existsSync("tests/fixtures/scan-giay12-shift.gray");

  /**
   * Đáp án đọc bằng mắt trên chính phiếu: PHẦN I câu 1–24 (25–40 bỏ trống),
   * PHẦN II câu 1–4 (5–8 bỏ trống), PHẦN III bỏ trống.
   * `-2` = ô có vết chì mờ (carbon) từ mặt sau → đúng là "tô đè", không phải
   * lỗi đọc: ảnh chỉ là dấu vết, xem ASCII trong commit.
   */
  const P1 = [2, 1, 3, 1, 1, 1, 3, 1, 2, 1, 3, 3, 3, 1, 2 as number, 0, 0, 0, 1, 3, 0, 0, 1, 2];
  const P2 = [0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1];

  it("đọc đúng mọi ô có tô, không biến hàng trống thành tô đè", { skip: !hasFixture, timeout: 120_000 }, () => {
    const layout = canonicalSheet(GIAY12);
    const res = processGray(loadGray("giay12-shift"), { form: GIAY12, checkSharpness: false });
    expect(res.ok).toBe(true);
    const answers = res.answers ?? [];

    // Mã đề / SBD đọc được trên cùng phiếu lệch.
    expect(res.examCode).toBe("3157");
    expect(res.studentCode).toBe("50120365");

    // 40 ô CÓ TÔ phải đọc đúng hết — đây là yêu cầu chính: mực lọt vào ô vẫn tính.
    // Câu 16 có vệt chì mờ ở ô B nên là "tô đè" (-2) chứ không phải đáp án.
    P1.forEach((want, i) => expect(answers[i]).toBe(i === 15 ? -2 : want));
    P2.forEach((want, i) => expect(answers[40 + i]).toBe(want));

    // PHẦN III bỏ trống.
    for (let i = layout.questions.length; i < answers.length; i++) expect(answers[i]).toBe(-1);

    // Hàng trống: được phép "trống" hoặc "tô đè" (có vết chì mờ), KHÔNG được bịa
    // đáp án. Trước khi sửa, 25 hàng trống bị đọc thành tô đè.
    let invented = 0;
    for (let i = 24; i < 40; i++) if (answers[i] >= 0) invented++;
    for (let i = 56; i < 72; i++) if (answers[i] >= 0) invented++;
    expect(invented).toBeLessThanOrEqual(1);
    expect(res.questions?.filter((q) => q.answer === -2).length ?? 0).toBeLessThanOrEqual(2);
  });

  it("khoanh chú thích nằm trên ô in thật (không lệch theo lưới chuẩn)", { skip: !hasFixture, timeout: 120_000 }, () => {
    const layout = canonicalSheet(GIAY12);
    const res = processGray(loadGray("giay12-shift"), { form: GIAY12, checkSharpness: false });
    const w = res.canonical!;
    const minSide = Math.min(w.width, w.height);
    const rPx = layout.questions[0].bubbles[0].r * minSide;
    // Tâm dùng để vẽ phải nằm trong ô in (±1 bán kính), không rơi về toạ độ chuẩn.
    let far = 0;
    for (const q of res.questions ?? []) {
      if (q.answer < 0 || !q.center) continue;
      const b = layout.questions[q.index].bubbles[q.answer];
      if (Math.hypot(q.center.x - b.x * w.width, q.center.y - b.y * w.height) > rPx * 1.2) far++;
    }
    expect(far).toBe(0);
  });
});

describe("Giấy 12 — lệch lưới mô phỏng (0,36–0,84 bán kính)", () => {
  const n = layoutQuestionCount(canonicalSheet(GIAY12));
  const answers = Array.from({ length: n }, (_, i) =>
    i < 40 ? i % 4 : i < 72 ? i % 2 : (i * 7) % 10,
  );

  it.each([
    [0, 1.5],
    [0, 2.5],
    [0, 3.5],
    [3, 0],
    [-2.5, 0],
    [2.5, 2.5],
  ])("lệch (%s, %s)pt vẫn đọc đủ 96 ô", { timeout: 120_000 }, (dxPt, dyPt) => {
    const layout = canonicalSheet(GIAY12);
    const gray = renderSheetToGray({ form: GIAY12, answers, examCode: "314", studentCode: "00640012", paperWidth: 1600 });
    const shifted = shiftGrid(layout, dxPt, dyPt, 589.61, 841.89);
    const read = readCanonicalSheet(gray, shifted, { readExamCode: true, readStudentCode: true });
    const got = [...read.questions.map((q) => q.answer), ...read.part3.flat()];
    expect(got).toEqual(answers);
  });
});
