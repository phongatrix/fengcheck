/**
 * Kiểm chứng end-to-end biến thể "Giấy 12 — mã đề 4 số":
 * render phiếu GIAY12 tô mã 4 số "2109" + đáp án đầy đủ →
 *  1. khai báo QM_A4 + key 3 số cũ → phải tự chuyển sang GIAY12, mã đọc đủ 4 số;
 *  2. matchKeyByCode khớp key 4 số '2109', và đuôi 3 số cho key cũ (1132↔132);
 *  3. SBD 8 số đọc đủ.
 */
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processWithFormDetection, matchKeyByCode } from "@/lib/omr/form-detect";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import type { FormConfig, FormKind } from "@/lib/omr/types";

function giay12Form(): FormConfig {
  const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true });
  return {
    ansNumber: layoutQuestionCount(layout),
    optionsPerQuestion: 4,
    form: "GIAY12" as FormKind,
    useExamCode: true,
    useStudentCode: true,
  };
}

const form = giay12Form();
const layout = canonicalSheet(form);
const signBase = layoutQuestionCount(layout);
const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
  if (i < layout.part1Count) return i % 4;
  if (i < layout.questions.length) return i % 2;
  if (i < signBase) return (i * 7) % 10;
  return -1;
});
answers[signBase] = 0;
answers[signBase + 1] = 0;
const gray = renderSheetToGray({
  form,
  answers,
  examCode: "2109",
  studentCode: "50120219",
  paperWidth: 1600,
});

describe("Giấy 12 — mã đề 4 số", { timeout: 180_000 }, () => {
  it("khai báo QM_A4 + key 3 số → tự chuyển GIAY12, đọc đủ mã 4 số", () => {
    const qmA4: FormConfig = { ansNumber: 96, optionsPerQuestion: 4, form: "QM_A4", useExamCode: true, useStudentCode: true };
    const res = processWithFormDetection(gray, qmA4, {
      checkSharpness: false,
      keys: [{ code: "745", answers: [] }, { code: "836", answers: [] }, { code: "894", answers: [] }, { code: "774", answers: [] }],
    });
    expect(res.formUsed).toBe("GIAY12");
    expect(res.formSwitched).toBe(true);
    expect(res.examCode).toBe("2109");
    // key 3 số hiện có không có "109" → không khớp được (đúng, không gán bừa)
    expect(matchKeyByCode(res.examCode, [{ code: "745", answers: [] }, { code: "836", answers: [] }])).toBeUndefined();
    const decided = (res.answers ?? []).filter((a) => a >= 0).length;
    expect(decided).toBeGreaterThan(60);
  });

  it("matchKeyByCode: ưu tiên key 4 số, đuôi 3 số cho key cũ", () => {
    // key 4 số có sẵn → khớp nguyên vẹn
    expect(matchKeyByCode("2109", [{ code: "2109", answers }])?.code).toBe("2109");
    // chỉ có key đuôi (phiếu 3 cột quy ước cũ) → khớp qua đuôi
    expect(matchKeyByCode("2109", [{ code: "109", answers }])?.code).toBe("109");
    // key 4 số trên phiếu 3 cột (1132 → đọc "132")
    expect(matchKeyByCode("132", [{ code: "1132", answers }])?.code).toBe("1132");
    // key 3 số lệch 1 chữ số đuôi ("2108" ≠ "109" — chỉ trùng khi đuôi đúng)
    expect(matchKeyByCode("2108", [{ code: "109", answers }])).toBeUndefined();
    // mã 3 số đọc thiếu số đầu (12 → 012)
    expect(matchKeyByCode("12", [{ code: "012", answers }])?.code).toBe("012");
  });

  it("SBD 8 số đọc đủ", () => {
    const res = processWithFormDetection(gray, form, { checkSharpness: false });
    expect(res.studentCode).toBe("50120219");
  });
});
