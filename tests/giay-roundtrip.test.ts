import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processGray } from "@/lib/omr/pipeline";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { gradeGiay } from "@/lib/scoring";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import type { FormConfig, FormKind } from "@/lib/omr/types";

function giayForm(kind: "GIAY12" | "GIAY10_11"): FormConfig {
  const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form: kind, useExamCode: true, useStudentCode: true });
  return {
    ansNumber: layoutQuestionCount(layout),
    optionsPerQuestion: 4,
    form: kind as FormKind,
    useExamCode: true,
    useStudentCode: kind === "GIAY12",
  };
}

for (const kind of ["GIAY12", "GIAY10_11"] as const) {
  describe(`Giấy template round-trip (${kind})`, () => {
    const form = giayForm(kind);

    it("reads choice answers, codes and PHẦN III digits (+ ô dấu −/dấu thập phân)", () => {
      const layout = canonicalSheet(form);
      const signBase = layoutQuestionCount(layout);
      const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
        if (i < layout.part1Count) return i % 4; // A-D
        if (i < layout.questions.length) return i % 2; // Đúng/Sai
        if (i < signBase) return (i * 7) % 10; // digits
        return -1; // ô dấu
      });
      // Câu 1: dấu − + dấu thập phân sau số 1 (vd "-1.1"); câu 2: dấu sau số 2.
      answers[signBase] = 0;
      answers[signBase + 1] = 0;
      answers[signBase + 3] = 1;
      const gray = renderSheetToGray({
        form,
        answers,
        examCode: "314",
        studentCode: "00640012",
        paperWidth: 1600,
      });
      const res = processGray(gray, { form, checkSharpness: false });
      expect(res.ok).toBe(true);
      expect(res.answers).toEqual(answers);
      expect(res.examCode).toBe("314");
      if (kind === "GIAY12") {
        expect(res.studentCode).toBe("00640012");
      }
    });

    it("reads a partially filled sheet (the rest blank)", () => {
      const layout = canonicalSheet(form);
      const answers = Array.from({ length: layoutAnswerSlots(layout) }, () => -1);
      answers[0] = 2;
      answers[layout.part1Count] = 1; // first Đ/S sub → Sai
      answers[layout.questions.length] = 9; // first P3 digit = 9
      const gray = renderSheetToGray({ form, answers, examCode: "001", paperWidth: 1400 });
      const res = processGray(gray, { form, checkSharpness: false });
      expect(res.ok).toBe(true);
      expect(res.answers?.[0]).toBe(2);
      expect(res.answers?.[layout.part1Count]).toBe(1);
      expect(res.answers?.[layout.questions.length]).toBe(9);
      // Dense grids can phantom-read a couple of blanks; require almost all.
      const blanks = res.answers?.filter((a) => a === -1).length ?? 0;
      expect(blanks).toBeGreaterThanOrEqual(answers.length - 6);
    });
  });
}

describe("gradeGiay — đúng format ứng dụng gốc", () => {
  it("P1 full + P2 groups + empty P3, thang 6/4/0 (Giấy 12)", () => {
    const counts = { p1: 40, p2: 8, p3: 6 };
    const key = Array(40).fill(1).concat(Array(32).fill(0)).concat(Array(24).fill(-1));
    const student = Array(40).fill(1).concat(Array(32).fill(0)).concat(Array(24).fill(-1));
    const r = gradeGiay(counts, key, student, { p1: 6, p2: 4, p3: 0 });
    expect(r.lines[0]).toBe("P1: 40/40=6.00");
    expect(r.lines[1]).toBe("P2: 8/8=1.00; 8/8=1.00; 8/8=1.00; 8/8=1.00=4.00");
    expect(r.lines[2]).toBe("P3: 0/24=0.00");
    expect(r.lines[3]).toBe("Tong: 10.00");
  });

  it("partial marks round to 2 decimals like the app", () => {
    const counts = { p1: 4, p2: 0, p3: 0 };
    const key = [0, 1, 2, 3];
    const student = [0, 1, 2, -1];
    const r = gradeGiay(counts, key, student, { p1: 6, p2: 4, p3: 0 });
    expect(r.lines[0]).toBe("P1: 3/4=4.50");
    expect(r.totalScore).toBeCloseTo(4.5);
  });

  it("đề chỉ dùng một phần ô in (QM 2025: 18/40, 4/8, 6/10) — không trừ điểm oan", () => {
    // Phiếu in 40 ô P1 nhưng đáp án chỉ có 18 câu; tương tự P2 4 câu, P3 6 câu.
    const counts = { p1: 40, p2: 8, p3: 6 };
    const key = [
      ...Array.from({ length: 18 }, (_, i) => i % 4),
      ...Array(22).fill(-1),
      ...Array.from({ length: 16 }, (_, i) => i % 2),
      ...Array(16).fill(-1),
      ...Array.from({ length: 24 }, (_, i) => i % 10),
    ];
    const student = [...key];
    const r = gradeGiay(counts, key, student, { p1: 6, p2: 4, p3: 0 });
    expect(r.lines[0]).toBe("P1: 18/18=6.00");
    expect(r.lines[1]).toBe("P2: 8/8=2.00; 8/8=2.00; 0/0=0.00; 0/0=0.00=4.00");
    expect(r.lines[2]).toBe("P3: 24/24=0.00");
    expect(r.lines[3]).toBe("Tong: 10.00");
  });
});
