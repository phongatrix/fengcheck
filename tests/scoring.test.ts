import { describe, expect, it } from "vitest";
import { gradeAnswers, formatScore, parsePartMaxes, parsePointLadder, splitGiayTotal } from "@/lib/scoring";
import {
  encodeShare,
  decodeShare,
  decodeShareForQuiz,
  normalizeExamCode,
  answersToLetters,
  lettersToAnswers,
} from "@/lib/sharecode";

describe("parsePartMaxes — thang điểm mẫu Giấy", () => {
  it("ba số đọc theo đúng thứ tự P1, P2, P3", () => {
    expect(parsePartMaxes("6,4,0")).toEqual({ p1: 6, p2: 4, p3: 0 });
    expect(parsePartMaxes("10,0,0")).toEqual({ p1: 10, p2: 0, p3: 0 });
    expect(parsePartMaxes("8;2;0")).toEqual({ p1: 8, p2: 2, p3: 0 });
  });

  it("MỘT số là tổng cả bài, chia 6/4 — không phải điểm PHẦN I", () => {
    // Trước đây "10" → p1=10, p2 tự điền 4: bài 40 câu hiện 0.25đ/câu mà tổng
    // thành 14. Nay "10" → 6/4/0, tổng vẫn 10.
    expect(parsePartMaxes("10")).toEqual({ p1: 6, p2: 4, p3: 0 });
    expect(parsePartMaxes("20")).toEqual({ p1: 12, p2: 8, p3: 0 });
    const m = parsePartMaxes("9");
    expect(m.p1 + m.p2 + m.p3).toBeCloseTo(9, 6);
  });

  it("hai số là (P1, P2), phần III để 0", () => {
    expect(parsePartMaxes("5,5")).toEqual({ p1: 5, p2: 5, p3: 0 });
  });

  it("rỗng → thang chuẩn 6/4/0", () => {
    expect(parsePartMaxes("")).toEqual({ p1: 6, p2: 4, p3: 0 });
    expect(parsePartMaxes(null)).toEqual({ p1: 6, p2: 4, p3: 0 });
  });

  it("splitGiayTotal luôn giữ đúng tổng sau làm tròn", () => {
    for (const t of [1, 3, 7, 9, 10, 11, 13]) {
      const [a, b, c] = splitGiayTotal(t);
      expect(a + b + c).toBeCloseTo(t, 6);
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });
});

describe("formatScore", () => {
  it("rounds half-up to 2 decimals like the Android app", () => {
    expect(formatScore(5 / 20)).toBe("0.25");
    expect(formatScore(0)).toBe("0.00");
    expect(formatScore(0.005)).toBe("0.01");
    expect(formatScore(-1.234)).toBe("-1.23");
    expect(formatScore(100 / 40)).toBe("2.50");
  });
});

describe("gradeAnswers", () => {
  it("computes correct/total=score with rounding", () => {
    const keyAnswers = [0, 1, 2, 3, 0];
    const studentAnswers = [0, 1, 2, 2, 0];
    const r = gradeAnswers(keyAnswers, studentAnswers, { maxScore: 10 });
    expect(r.parts[0].correct).toBe(4);
    expect(r.parts[0].total).toBe(5);
    expect(r.text).toBe("4/5=8.00");
  });

  it("handles blank answers as wrong", () => {
    const r = gradeAnswers([0, 1, -1], [0, -1, -1], { maxScore: 10 });
    expect(r.correct).toBe(1);
    expect(r.text).toBe("1/3=3.33");
  });

  it("supports split grading of 40-question blocks", () => {
    const keyAnswers = Array.from({ length: 80 }, (_, i) => i % 4);
    // First block: perfect. Second block: every answer shifted by one → 0 correct.
    const studentAnswers = Array.from({ length: 80 }, (_, i) =>
      i < 40 ? keyAnswers[i] : (keyAnswers[i] + 1) % 4,
    );
    const r = gradeAnswers(keyAnswers, studentAnswers, { isSplit: true, maxScore: 10 });
    expect(r.parts).toHaveLength(2);
    expect(r.parts[0].text).toBe("40/40=10.00");
    expect(r.parts[1].text).toBe("0/40=0.00");
  });

  it("supports point ladders across parts", () => {
    const key = Array(10).fill(0);
    const student = Array(10).fill(0);
    const parts = parsePointLadder("4,6", 10); // 5 + 5 questions
    expect(parts).not.toBeNull();
    const r = gradeAnswers(key, student, { parts: parts ?? undefined });
    expect(r.parts).toHaveLength(2);
    expect(r.parts[0].text).toBe("5/5=4.00");
    expect(r.parts[1].text).toBe("5/5=6.00");
    expect(r.totalScore).toBeCloseTo(10);
  });
});

describe("share codes", () => {
  it("encodes and decodes the app format exactly", () => {
    const encoded = encodeShare([{ code: "001", answers: [0, 1, 2, 3] }], 4);
    expect(encoded.startsWith("123456789001004")).toBe(true);
    const decoded = decodeShare(encoded);
    expect(decoded.ok).toBe(true);
    expect(decoded.keys?.[0].code).toBe("001");
    expect(decoded.keys?.[0].answers).toEqual([0, 1, 2, 3]);
  });

  it("rejects strings without the app prefix", () => {
    expect(decodeShare("abc123").ok).toBe(false);
  });

  it("rejects wrong question counts", () => {
    // Well-formed share string for 5 questions: header + one 8-char block.
    const res = decodeShareForQuiz("12345678900100500101234", 4);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("không khớp");
  });

  it("normalizes exam codes", () => {
    expect(normalizeExamCode("7.0")).toBe("007");
    expect(normalizeExamCode(12)).toBe("012");
  });

  it("round-trips letters to answers", () => {
    expect(answersToLetters([-1, 2, 0])).toEqual(["-", "C", "A"]);
    expect(lettersToAnswers(["A", "B", "Z"])).toEqual([0, 1, -1]);
  });
});
