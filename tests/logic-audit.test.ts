import { describe, expect, it } from "vitest";
import { gradeGiay } from "@/lib/scoring";
import { cauCountsForQuiz } from "@/lib/points";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { QuizRecord } from "@/lib/db";

/**
 * Hồi quy cho đợt rà soát logic 2026-11-13 — mỗi test khoá một lỗi đã sửa.
 */

function quizOf(patch: Partial<QuizRecord> = {}): QuizRecord {
  return {
    id: "q", name: "t", ansNumber: 96, form: "GIAY12", isSplit: false,
    pointLadder: "6,4,0", stdCode: false, selectCourses: "", ...patch,
  };
}

const SUB = [0.25, 0.5, 0.75, 1];

describe("PHẦN II — thang luỹ tiến theo số ý đúng", () => {
  const LADDER = [0.1, 0.25, 0.5, 1.0];

  it("trúng 1/2/3/4 ý = đúng mức 1/2/3/4 của thang", () => {
    const counts = { p1: 0, p2: 1, p3: 0 };
    const key = Array(4).fill(0);
    const run = (n: number) => {
      const stu = Array(4).fill(-1);
      for (let k = 0; k < n; k++) stu[k] = 0;
      return gradeGiay(counts, key, stu, { p1: 0, p2: 1, p3: 0 }, { p2Sub: LADDER }).totalScore;
    };
    expect(run(1)).toBeCloseTo(0.1, 6);
    expect(run(2)).toBeCloseTo(0.25, 6);
    expect(run(3)).toBeCloseTo(0.5, 6);
    expect(run(4)).toBeCloseTo(1, 6);
  });

  it("trúng ý d (không phải ý b) vẫn tính đúng số ý", () => {
    // Ý d đúng đơn độc → 1 ý → 0.1, không phụ thuộc ý nào (bug lệch pha đã sửa).
    const counts = { p1: 2, p2: 3, p3: 0 };
    const key = Array(2 + 12).fill(0);
    const stu = Array(2 + 12).fill(-1);
    stu[2 + 4 + 3] = 0;
    const g = gradeGiay(counts, key, stu, { p1: 0, p2: 3, p3: 0 }, { p2Sub: LADDER });
    expect(g.totalScore).toBeCloseTo(0.1, 6);
  });

  it("mỗi câu đúng hết 4 ý nhận đúng mức 4 của thang", () => {
    const counts = { p1: 0, p2: 3, p3: 0 };
    const key = Array(12).fill(0);
    const g = gradeGiay(counts, key, key, { p1: 0, p2: 3, p3: 0 }, { p2Sub: LADDER });
    expect(g.totalScore).toBeCloseTo(3, 6);
  });

  it("p2Row cho điểm riêng từng câu", () => {
    const counts = { p1: 0, p2: 2, p3: 0 };
    const key = Array(8).fill(0);
    // câu 1 thang khác: đúng 4 ý = 2.0
    const g = gradeGiay(counts, key, key, { p1: 0, p2: 2, p3: 0 }, { p2Row: [[0.2, 0.5, 1, 2], LADDER] });
    expect(g.totalScore).toBeCloseTo(3, 6); // 2.0 + 1.0
  });
});

describe("partCount — số câu người dùng đặt", () => {
  const layout = canonicalSheet({ ansNumber: 96, optionsPerQuestion: 4, form: "QM_A4", useExamCode: true, useStudentCode: true });

  it("0 / ô trắng = không đặt → dùng số câu của mẫu (không mất trắng phần)", () => {
    const c = cauCountsForQuiz(quizOf({ form: "QM_A4", points: { partMax: [6, 4, 0], partCount: [0, 8, 6] } }), layout);
    expect(c.p1).toBe(40);
  });

  it("đề chỉ dùng 24/40 câu: đúng 24 câu vẫn đạt trọn 6 điểm", () => {
    const key = Array(96).fill(0);
    const stu = Array.from({ length: 96 }, (_, i) => (i < 24 ? 0 : i < 40 ? 1 : 0));
    const g24 = gradeGiay({ p1: 24, p2: 8, p3: 6 }, key, stu, { p1: 6, p2: 4, p3: 0 });
    expect(g24.lines[0]).toBe("P1: 24/24=6.00");
    // chấm trên 40 ô thì 16 câu "không dùng" bị tính sai
    const g40 = gradeGiay({ p1: 40, p2: 8, p3: 6 }, key, stu, { p1: 6, p2: 4, p3: 0 });
    expect(g40.lines[0]).toBe("P1: 24/40=3.60");
  });
});
