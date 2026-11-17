import { describe, expect, it } from "vitest";
import { gradeGiay, gradeAnswers, scorePart, formatScore, parsePartMaxes } from "@/lib/scoring";
import {
  cellWeightsFor,
  cauCountsForQuiz,
  distribute,
  gradeConfigOf,
  pointsOf,
  resolvePerCau,
  totalCau,
} from "@/lib/points";
import { groupBySession, sortBatch } from "@/lib/results-group";
import { scoreParts } from "@/lib/export-ketqua";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { QuizRecord } from "@/lib/db";

function quiz(patch: Partial<QuizRecord> = {}): QuizRecord {
  return {
    id: "q1",
    name: "Test",
    ansNumber: 4,
    form: "A4",
    isSplit: false,
    pointLadder: "10",
    stdCode: false,
    selectCourses: "",
    ...patch,
  };
}

describe("scorePart với điểm từng câu", () => {
  it("chia đều khi không có trọng số", () => {
    const r = scorePart([0, 0, 0, 0], [0, 1, 1, 1], 0, 4, 8);
    expect(r.correct).toBe(1);
    expect(r.text).toBe("1/4=2.00");
  });

  it("chấm theo trọng số: câu khó hơn được nhiều điểm hơn", () => {
    // Câu 4 = 4 điểm, 3 câu còn lại = 2 điểm mỗi câu → tổng 10.
    // Học sinh đúng câu 4 (4đ) và sai hết → 4/10.
    const weights = [2, 2, 2, 4];
    const r = scorePart([0, 0, 0, 0], [1, 1, 1, 0], 0, 4, 10, { weights });
    expect(r.correct).toBe(1);
    expect(r.total).toBe(4);
    expect(formatScore(r.score)).toBe("4.00");
  });

  it("tổng điểm phần luôn bằng maxScore khi đúng hết", () => {
    const weights = [1, 2, 3, 4];
    const key = [0, 1, 2, 3];
    const r = scorePart(key, key, 0, 4, 7, { weights });
    expect(formatScore(r.score)).toBe("7.00");
  });

  it("không có đáp án trong phần → 0 điểm, không NaN", () => {
    const r = scorePart([-1, -1], [-1, -1], 0, 2, 5, { weights: [1, 1] });
    expect(Number.isFinite(r.score)).toBe(true);
    expect(formatScore(r.score)).toBe("0.00");
  });
});

describe("gradeAnswers với trọng số", () => {
  it("áp trọng số cho toàn bài", () => {
    const key = [0, 1, 2, 3];
    const student = [0, 9, 9, 9];
    const r = gradeAnswers(key, student, { maxScore: 6, weights: [3, 1, 1, 1] });
    // đúng câu 1 (3đ / 6đ trọng số) → 6 × 3/6 = 3.00
    expect(formatScore(r.totalScore)).toBe("3.00");
  });
});

describe("gradeGiay với điểm từng câu", () => {
  // Mẫu nhỏ: P1 4 câu, P2 2 câu (8 ý), P3 1 câu (4 cột)
  const counts = { p1: 4, p2: 2, p3: 1 };
  const key = [0, 1, 2, 3, /* P2: 2 câu × 4 ý */ 0, 0, 0, 0, 1, 1, 1, 1, /* P3 */ 1, 2, 3, 4];

  it("giữ nguyên kết quả khi không có trọng số", () => {
    const r = gradeGiay(counts, key, key, { p1: 4, p2: 4, p3: 2 });
    expect(r.lines[0]).toBe("P1: 4/4=4.00");
    expect(r.lines[3]).toBe("Tong: 10.00");
  });

  it("P2 chia điểm theo từng ý a–d", () => {
    const r = gradeGiay(counts, key, key, { p1: 4, p2: 4, p3: 2 });
    expect(r.lines[1]).toBe("P2: 8/8=4.00=4.00");
    expect(formatScore(r.totalScore)).toBe("10.00");
  });

  it("câu P1 khó hơn được nhiều điểm hơn", () => {
    const weights = [1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const student = [-1, -1, -1, 3, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 3, 4];
    const r = gradeGiay(counts, key, student, { p1: 4, p2: 4, p3: 2 }, { weights });
    // P1: chỉ đúng câu 4 (3/6 trọng số) = 2.00; P2 + P3 đúng hết = 6.00
    expect(r.lines[0]).toBe("P1: 1/4=2.00");
    expect(r.lines[3]).toBe("Tong: 8.00");
  });
});

describe("points helpers", () => {
  const qm = canonicalSheet({ ansNumber: 40, optionsPerQuestion: 4, form: "QM_A4", useExamCode: true, useStudentCode: true });

  it("thang mặc định cũ \"6,4,0\" → thang chuẩn của mẫu (P1 0.25đ/câu, P3 0.5đ/câu)", () => {
    // "6,4,0" là giá trị app TỰ ĐIỀN ở bản trước, không phải người dùng chọn:
    // QM_A4 40 câu cần 40 × 0.25 = 10 điểm PHẦN I. Nay thay bằng thang chuẩn.
    const p = pointsOf(quiz({ form: "QM_A4", pointLadder: "6,4,0" }), qm);
    expect(p.partMax).toEqual([10, 8, 3]);
    expect(p.perCau).toBeNull();
  });

  it("thang người dùng CHỦ ĐỘNG nhập vẫn được tôn trọng", () => {
    const p = pointsOf(quiz({ form: "QM_A4", pointLadder: "8,2,0" }), qm);
    expect(p.partMax).toEqual([8, 2, 0]);
  });

  it("ưu tiên cấu hình points đã lưu", () => {
    const p = pointsOf(
      quiz({ form: "QM_A4", points: { partMax: [7, 3, 0], perCau: null } }),
      qm,
    );
    expect(p.partMax).toEqual([7, 3, 0]);
  });

  it("đếm câu mỗi phần theo layout của mẫu", () => {
    const c = cauCountsForQuiz(quiz({ form: "QM_A4" }), qm);
    expect(c.p1).toBe(40);
    expect(c.p2).toBe(8);
    expect(c.p3).toBe(6);
    expect(totalCau(c)).toBe(54);
  });

  it("gửi trọng số xuống worker khi có câu khác điểm", () => {
    const perCau = Array.from({ length: 54 }, () => 1);
    perCau[0] = 3;
    const cfg = gradeConfigOf(
      quiz({ form: "QM_A4", points: { partMax: [6, 4, 0], perCau } }),
      qm,
      { isSplit: false, defaultMax: 10 },
    );
    expect(cfg.ladder).toBe("6,4,0");
    expect(cfg.perCau?.[0]).toBe(3);
    expect(cfg.cauCounts).toEqual({ p1: 40, p2: 8, p3: 6 });
  });

  it("không gửi trọng số khi mọi câu bằng nhau", () => {
    const cfg = gradeConfigOf(
      quiz({ form: "QM_A4", points: { partMax: [6, 4, 0], perCau: Array.from({ length: 54 }, () => 1) } }),
      qm,
      { isSplit: false, defaultMax: 10 },
    );
    expect(cfg.perCau).toBeNull();
  });

  it("gửi trọng số khi chỉ MỘT câu có điểm riêng (các câu khác bỏ trống)", () => {
    const perCau: (number | null)[] = Array.from({ length: 54 }, () => null);
    perCau[0] = 0.5;
    const cfg = gradeConfigOf(
      quiz({ form: "QM_A4", points: { partMax: [6, 4, 0], perCau } }),
      qm,
      { isSplit: false, defaultMax: 10 },
    );
    expect(cfg.perCau).not.toBeNull();
    expect(cfg.perCau?.[0]).toBe(0.5);
    expect(cfg.perCau?.[1]).toBeCloseTo(6 / 40, 6); // câu trống = chia đều phần
  });

  it("đổi điểm phần → câu trống nhận điểm chia đều mới", () => {
    const perCau: (number | null)[] = Array.from({ length: 54 }, () => null);
    perCau[0] = 1;
    const cfg = gradeConfigOf(
      quiz({ form: "QM_A4", points: { partMax: [8, 2, 0], perCau } }),
      qm,
      { isSplit: false, defaultMax: 10 },
    );
    expect(cfg.perCau?.[1]).toBeCloseTo(8 / 40, 6);
  });

  it("ô trống (null) được điền bằng điểm chia đều của phần", () => {
    const c = { p1: 2, p2: 1, p3: 0 };
    const perCau = [null, 3, null];
    const out = resolvePerCau(perCau, [4, 6, 0], quiz({ form: "QM_A4" }), c);
    expect(out[0]).toBe(2); // P1 4 điểm / 2 câu
    expect(out[1]).toBe(3); // điểm riêng
    expect(out[2]).toBe(6); // P2 6 điểm / 1 câu
  });

  it("trải trọng số sang ô P2/P3 của layout đích", () => {
    const src = { p1: 2, p2: 1, p3: 0 };
    const dst = { p1: 3, p2: 2, p3: 1 };
    const cells = cellWeightsFor([1, 2, 8], src, dst);
    // P1: 1, 2, 1 (câu 3 chưa có điểm → 1)
    expect(cells.slice(0, 3)).toEqual([1, 2, 1]);
    // P2 câu 1 = 8 → 4 ý × 2
    expect(cells.slice(3, 7)).toEqual([2, 2, 2, 2]);
    // P2 câu 2 chưa có điểm → 1 → 4 ý × 0.25
    expect(cells.slice(7, 11)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("distribute chia câu cho các phần theo thang điểm", () => {
    expect(distribute(10, [4, 6])).toEqual([
      { maxScore: 4, count: 5 },
      { maxScore: 6, count: 5 },
    ]);
  });
});

describe("tách đợt chấm", () => {
  const t0 = Date.UTC(2026, 10, 13, 1, 0, 0);
  const min = 60_000;

  it("mỗi lượt upload là một đợt, dù cách nhau vài phút", () => {
    const rows = [
      { time: t0, sessionId: "a", score: "Tong: 5" },
      { time: t0 + min, sessionId: "a", score: "Tong: 6" },
      { time: t0 + 3 * min, sessionId: "b", score: "Tong: 7" },
    ];
    const g = groupBySession(rows);
    expect(g).toHaveLength(2);
    // Khoá đợt = "mã đợt|bài thi" (tách đợt khi đổi bài thi trong cùng mã đợt).
    expect(g[0].key.startsWith("b|")).toBe(true); // đợt mới nhất lên đầu
    expect(g[1].records).toHaveLength(2);
  });

  it("bản ghi lẻ gộp theo thời gian, đợt mới nhất ở trên", () => {
    const rows = [
      { time: t0, score: "Tong: 1" },
      { time: t0 + 10 * min, score: "Tong: 2" },
      { time: t0 + 90 * min, score: "Tong: 3" },
    ];
    const g = groupBySession(rows);
    expect(g).toHaveLength(2);
    expect(g[0].start).toBe(t0 + 90 * min);
    expect(g[1].records).toHaveLength(2);
  });

  it("trộn: đợt upload tách khỏi bài chấm lẻ", () => {
    const rows = [
      { time: t0, sessionId: "a" },
      { time: t0 + min, score: "Tong: 1" },
    ];
    const g = groupBySession(rows);
    expect(g).toHaveLength(2);
    expect(g.filter((x) => x.batch)).toHaveLength(1);
  });

  it("sắp xếp trong đợt: có điểm trước (SBD tăng dần), không điểm cuối", () => {
    const rows = [
      { time: t0, stdCode: "200", score: "P1: 1/2=1.00" },
      { time: t0 + 1, stdCode: "100", score: "Tong: 5.00" },
      { time: t0 + 2, stdCode: "050", score: "Tong: 4.00" },
      { time: t0 + 3, stdCode: "", score: "" },
    ];
    const sorted = sortBatch(rows);
    // Có điểm (kể cả phiếu một phần không có dòng Tong) xếp theo SBD tăng dần;
    // bản ghi không có điểm xuống cuối.
    expect(sorted.map((r) => r.stdCode)).toEqual(["050", "100", "200", ""]);
  });

  it("phiếu một phần '8/10=8.00' vẫn được coi là CÓ điểm", () => {
    const sorted = sortBatch([
      { time: t0, stdCode: "010", score: "" },
      { time: t0 + 1, stdCode: "020", score: "8/10=8.00" },
    ]);
    expect(sorted.map((r) => r.stdCode)).toEqual(["020", "010"]);
  });
});

describe("tách đợt theo bài thi", () => {
  const t0 = Date.UTC(2026, 10, 13, 1, 0, 0);
  const min = 60_000;

  it("hai bài thi chấm liền nhau không chung một đợt", () => {
    const rows = [
      { time: t0, quizId: "q1", score: "Tong: 5" },
      { time: t0 + min, quizId: "q2", score: "Tong: 6" },
      { time: t0 + 2 * min, quizId: "q1", score: "Tong: 7" },
    ];
    const g = groupBySession(rows);
    // q1: 2 bản ghi (cách nhau 2 phút, cùng bài) → 1 đợt; q2: 1 đợt
    expect(g).toHaveLength(2);
    expect(g.filter((x) => x.records.every((r) => r.quizId === "q1"))).toHaveLength(1);
    expect(g.filter((x) => x.records.every((r) => r.quizId === "q2"))).toHaveLength(1);
  });
});

describe("scoreParts export cho phiếu một phần", () => {
  it("dòng '8/10=8.00' → tong = 8.00", () => {
    const p = scoreParts("8/10=8.00");
    expect(p.tong).toBe("8.00");
    expect(p.p1).toBe("8.00");
  });
});

describe("pointsOf — thang điểm một số trên phiếu 3 phần", () => {
  const g12 = canonicalSheet({ ansNumber: 96, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true });

  it("ladder '10' (mặc định cũ) → thang chuẩn Giấy 12: 10/8/3", () => {
    // Công thức chốt: P1 = số câu × 0.25 = 40 × 0.25 = 10; P2 = 1đ/câu × 8 = 8;
    // P3 = 0.5đ/câu × 6 = 3. Tổng tối đa = 21.
    const p = pointsOf(quiz({ form: "GIAY12", ansNumber: 96, pointLadder: "10" }), g12);
    expect(p.partMax).toEqual([10, 8, 3]);
    expect(p.partMax[0] / cauCountsForQuiz(quiz({ form: "GIAY12" }), g12).p1).toBeCloseTo(0.25, 6);
  });

  it("Giấy 10-11 dùng CÙNG công thức: 7,5/10/5", () => {
    const g1011 = canonicalSheet({ ansNumber: 110, optionsPerQuestion: 4, form: "GIAY10_11", useExamCode: true, useStudentCode: false });
    const p = pointsOf(quiz({ form: "GIAY10_11", ansNumber: 110, pointLadder: "10" }), g1011);
    // 30 × 0.25 = 7.5 · 10 × 1 = 10 · 10 × 0.5 = 5 → tổng 22.5
    expect(p.partMax).toEqual([7.5, 10, 5]);
  });

  it("dữ liệu cũ đã lưu partMax = [10] cũng được chuẩn hoá", () => {
    const p = pointsOf(quiz({ form: "GIAY12", ansNumber: 96, points: { partMax: [10], perCau: null } }), g12);
    expect(p.partMax).toEqual([6, 4, 0]);
  });

  it("partMax 3 phần đã lưu thì giữ nguyên", () => {
    const p = pointsOf(quiz({ form: "GIAY12", ansNumber: 96, points: { partMax: [8, 2, 0], perCau: null } }), g12);
    expect(p.partMax).toEqual([8, 2, 0]);
  });
});

describe("partCount — số lượng câu đặt trong Thiết lập điểm", () => {
  const qm = canonicalSheet({ ansNumber: 40, optionsPerQuestion: 4, form: "QM_A4", useExamCode: true, useStudentCode: true });

  it("ưu tiên partCount; kẹp theo số ô in của mẫu", () => {
    const c = cauCountsForQuiz(quiz({ form: "QM_A4", points: { partMax: [6, 4, 0], partCount: [24, 8, 6] } }), qm);
    expect(c).toEqual({ p1: 24, p2: 8, p3: 6 });
    // 99 > 40 ô in → kẹp về 40
    const clamped = cauCountsForQuiz(quiz({ form: "QM_A4", points: { partMax: [6, 4, 0], partCount: [99, 8, 6] } }), qm);
    expect(clamped.p1).toBe(40);
  });

  it("không có partCount → số câu của mẫu", () => {
    const c = cauCountsForQuiz(quiz({ form: "QM_A4" }), qm);
    expect(c).toEqual({ p1: 40, p2: 8, p3: 6 });
  });

  it("điểm 1 câu × số câu = điểm phần: 24 câu × 0.25 = 6.00", () => {
    const per = 0.25;
    const c = { p1: 24, p2: 8, p3: 6 };
    const key = Array.from({ length: 96 }, (_, i) => (i < 24 ? i % 4 : -1));
    const g = gradeGiay(c, key, key, { p1: 24 * per, p2: 4, p3: 0 });
    expect(g.lines[0]).toBe("P1: 24/24=6.00");
  });

  it("gradeConfigOf gửi partCount xuống worker", () => {
    const cfg = gradeConfigOf(
      quiz({ form: "QM_A4", points: { partMax: [6, 4, 0], partCount: [24, 8, 6] } }),
      qm,
      { isSplit: false, defaultMax: 10 },
    );
    expect(cfg.cauCounts).toEqual({ p1: 24, p2: 8, p3: 6 });
    expect(cfg.ladder).toBe("6,4,0");
  });
});

describe("PHẦN II — điểm từng ý a–d", () => {
  const counts = { p1: 40, p2: 4, p3: 6 };
  const sub = [0.25, 0.5, 0.75, 1.0];
  // Tổng PHẦN II = SỐ CÂU (mỗi câu 1 điểm); 4 mức ý chỉ chia tỷ lệ trong 1 điểm.
  const p2Max = counts.p2;

  /** Đáp án: P1 40 câu (A), P2 16 ô (Đ), P3 24 cột (0). */
  const key = [...Array(40).fill(0), ...Array(16).fill(0), ...Array(24).fill(0)];

  it("đúng cả 4 ý một câu = trọn 1 điểm của câu", () => {
    const stu = [...key];
    for (let i = 44; i < 56; i++) stu[i] = -1; // 3 câu P2 còn lại bỏ trống
    const g = gradeGiay(counts, key, stu, { p1: 0, p2: p2Max, p3: 0 }, { p2Sub: sub });
    expect(g.totalScore).toBeCloseTo(1, 6);
  });

  it("4 câu đúng hết = số câu × 1 = 4.00", () => {
    const g = gradeGiay(counts, key, key, { p1: 0, p2: p2Max, p3: 0 }, { p2Sub: sub });
    expect(g.totalScore).toBeCloseTo(4, 6);
  });

  it("thang luỹ tiến: trúng 1/2/3/4 ý = 0.1 / 0.25 / 0.5 / 1.0", () => {
    const L = [0.1, 0.25, 0.5, 1.0];
    const run = (n: number) => {
      const stu = [...key];
      for (let k = n; k < 4; k++) stu[40 + k] = -1;
      for (let i = 44; i < 56; i++) stu[i] = -1;
      return gradeGiay(counts, key, stu, { p1: 0, p2: p2Max, p3: 0 }, { p2Sub: L }).totalScore;
    };
    expect(run(1)).toBeCloseTo(0.1, 6);
    expect(run(2)).toBeCloseTo(0.25, 6);
    expect(run(3)).toBeCloseTo(0.5, 6);
    expect(run(4)).toBeCloseTo(1, 6);
  });

  it("đổi các mức làm đổi điểm (thang là điểm thật, không phải tỷ lệ)", () => {
    const g1 = gradeGiay(counts, key, key, { p1: 0, p2: 4, p3: 0 }, { p2Sub: [0.1, 0.25, 0.5, 1] });
    const g2 = gradeGiay(counts, key, key, { p1: 0, p2: 4, p3: 0 }, { p2Sub: [1, 2, 3, 4] });
    expect(g1.totalScore).toBeCloseTo(4, 6);   // 4 câu × 1.0
    expect(g2.totalScore).toBeCloseTo(16, 6);  // 4 câu × 4.0
  });

  it("không có p2Sub → giữ cách chia đều cũ", () => {
    const g = gradeGiay(counts, key, key, { p1: 0, p2: 4, p3: 0 });
    expect(g.totalScore).toBeCloseTo(4, 6);
  });

  it("gradeConfigOf gửi p2Sub xuống worker", () => {
    const g12 = canonicalSheet({ ansNumber: 96, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true });
    const cfg = gradeConfigOf(
      quiz({ form: "GIAY12", points: { partMax: [24, 10, 12], partCount: [40, 4, 6], p2Sub: sub } }),
      g12,
      { isSplit: false, defaultMax: 10 },
    );
    expect(cfg.p2Sub).toEqual(sub);
  });

});

describe("PHẦN III — số câu × điểm 1 câu", () => {
  const counts = { p1: 40, p2: 8, p3: 6 };
  const key = [...Array(40).fill(0), ...Array(32).fill(0), ...Array(24).fill(0)];

  it("6 câu × 0.25 = 1.50 điểm phần", () => {
    const g = gradeGiay(counts, key, key, { p1: 6, p2: 4, p3: 6 * 0.25 });
    expect(g.lines[2]).toBe("P3: 24/24=1.50");
  });

  it("đúng 1 câu PHẦN III được 0.25", () => {
    const stu = [...key];
    for (let i = 40 + 32 + 4; i < 40 + 32 + 24; i++) stu[i] = 9;
    const g = gradeGiay(counts, key, stu, { p1: 6, p2: 4, p3: 1.5 });
    expect(g.lines[2]).toBe("P3: 4/24=0.25");
  });

  it("ladder 3 phần đọc đúng số lẻ thập phân", () => {
    expect(parsePartMaxes("6,4,1.5")).toEqual({ p1: 6, p2: 4, p3: 1.5 });
  });
});
