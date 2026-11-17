/**
 * Công thức điểm mẫu Giấy — Giấy 10-11 GIỐNG Giấy 12 (yêu cầu 2026-11-16):
 *   P1 = số câu × 0.25
 *   P2 = thang luỹ tiến 0.1/0.25/0.5/1 theo số ý đúng (tối đa 1 điểm/câu)
 *   P3 = số câu × 0.5
 *   Tổng = P1 + P2 + P3
 */
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { cauCountsOf, giayStandardMaxes, pointsOf, GIAY_P2_LADDER } from "@/lib/points";
import { gradeGiay } from "@/lib/scoring";
import type { QuizRecord } from "@/lib/db";
import type { FormKind } from "@/lib/omr/types";

const quiz = (form: FormKind): QuizRecord =>
  ({ id: "q", name: "t", ansNumber: 96, form, isSplit: false, pointLadder: "", stdCode: false, selectCourses: "" }) as QuizRecord;

describe("công thức điểm mẫu Giấy (12 và 10-11 dùng chung)", () => {
  it("Giấy 12: 40 câu P1 → 10 · 8 câu P2 → 8 · 6 câu P3 → 3 (tổng 21)", () => {
    const m = giayStandardMaxes({ p1: 40, p2: 8, p3: 6 });
    expect(m).toEqual({ p1: 10, p2: 8, p3: 3 });
  });

  it("Giấy 10-11: 30 câu P1 → 7.5 · 10 câu P2 → 10 · 10 câu P3 → 5 (tổng 22.5)", () => {
    const m = giayStandardMaxes({ p1: 30, p2: 10, p3: 10 });
    expect(m).toEqual({ p1: 7.5, p2: 10, p3: 5 });
  });

  it("pointsOf: cả hai mẫu lấy đúng thang chuẩn khi chưa cấu hình", () => {
    for (const [form, want] of [
      ["GIAY12", [10, 8, 3]],
      ["GIAY10_11", [7.5, 10, 5]],
    ] as const) {
      const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
      const p = pointsOf(quiz(form), layout);
      expect(p.partMax).toEqual([...want]);
      expect(cauCountsOf(layout)).toBeTruthy();
    }
  });

  it("thang P2 = 0.1/0.25/0.5/1 (1 điểm khi đúng cả 4 ý)", () => {
    expect(GIAY_P2_LADDER).toEqual([0.1, 0.25, 0.5, 1]);
  });

  it("chấm đủ điểm: tổng = P1 + P2 + P3, P2 = 1đ/câu, P3 = 0.5đ/câu", () => {
    const counts = { p1: 30, p2: 10, p3: 10 };
    const key: number[] = [];
    for (let i = 0; i < 30; i++) key.push(0); // P1 toàn A
    for (let c = 0; c < 10; c++) key.push(1, 0, 0, 1); // P2 mỗi câu Đ,S,S,Đ
    for (let c = 0; c < 10; c++) key.push(1, 2, 3, 4); // P3 mỗi câu 1,2,3,4
    const g = gradeGiay(counts, key, [...key], { p1: 7.5, p2: 10, p3: 5 });
    expect(g.lines[0]).toBe("P1: 30/30=7.50");
    expect(g.lines[1].endsWith("=10.00")).toBe(true);
    expect(g.lines[2]).toBe("P3: 40/40=5.00");
    expect(g.totalScore).toBeCloseTo(22.5, 6);
  });

  it("P2: đúng 2/4 ý = 0.25 điểm (mức 2 của thang)", () => {
    const counts = { p1: 0, p2: 1, p3: 0 };
    const key = [1, 0, 0, 1];
    const student = [1, 0, 1, 0]; // đúng 2 ý (ý a, b)
    const g = gradeGiay(counts, key, student, { p1: 0, p2: 1, p3: 0 });
    expect(g.totalScore).toBeCloseTo(0.25, 6);
  });

  it("P2: đúng 4/4 ý = 1.0 điểm · 1/4 ý = 0.1", () => {
    const counts = { p1: 0, p2: 1, p3: 0 };
    const key = [0, 0, 0, 0];
    // đúng cả 4 ý (student trùng key) → mức 4 = 1.0
    expect(gradeGiay(counts, key, [0, 0, 0, 0], { p1: 0, p2: 1, p3: 0 }).totalScore).toBeCloseTo(1, 6);
    // đúng 1/4 ý → mức 1 = 0.1
    expect(gradeGiay(counts, key, [0, 1, 1, 1], { p1: 0, p2: 1, p3: 0 }).totalScore).toBeCloseTo(0.1, 6);
    // 3/4 ý → mức 3 = 0.5
    expect(gradeGiay(counts, key, [0, 0, 0, 1], { p1: 0, p2: 1, p3: 0 }).totalScore).toBeCloseTo(0.5, 6);
  });

  it("P3: mỗi câu 0.5 điểm (4 ô đúng), đúng 2/4 ô = 0.25", () => {
    const counts = { p1: 0, p2: 0, p3: 1 };
    const key = [1, 2, 3, 4];
    expect(gradeGiay(counts, key, [1, 2, 3, 4], { p1: 0, p2: 0, p3: 0.5 }).totalScore).toBeCloseTo(0.5, 6);
    expect(gradeGiay(counts, key, [1, 2, 9, 9], { p1: 0, p2: 0, p3: 0.5 }).totalScore).toBeCloseTo(0.25, 6);
  });
});
