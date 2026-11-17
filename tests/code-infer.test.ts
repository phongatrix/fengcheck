import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { inferCodeFromAnswers, MIN_INFER_CELLS } from "@/lib/omr/code-infer";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { FormKind } from "@/lib/omr/types";

const key101: { code: string; answers: number[] } = JSON.parse(
  readFileSync("tests/fixtures/key101.json", "utf8"),
);
const MOI = canonicalSheet({ ansNumber: 68, optionsPerQuestion: 4, form: "MOI", useExamCode: true, useStudentCode: false });

/** Mã thứ hai: đảo đáp án P1/P2 để chắc chắn tỉ lệ khớp thấp. */
function otherKey(): { code: string; answers: number[] } {
  const a = key101.answers.map((v, i) => {
    if (v < 0) return v;
    if (i < 36) return (v + 1) % 4; // P1/P2: luôn khác đáp án gốc
    return v;
  });
  return { code: "209", answers: a };
}

describe("inferCodeFromAnswers", () => {
  it("nhận đúng mã khi bài khớp 100%", () => {
    const g = inferCodeFromAnswers(key101.answers, MOI, [key101, otherKey()], "MOI", 68);
    expect(g?.code).toBe("101");
    expect(g?.ratio).toBe(1);
  });

  it("nhận đúng mã khi sai 2 câu (tỉ lệ > 80%)", () => {
    const read = key101.answers.slice();
    // đổi đáp án 2 câu P1 → sai
    for (let i = 0; i < 2; i++) read[i] = (read[i] + 1) % 4;
    const g = inferCodeFromAnswers(read, MOI, [key101, otherKey()], "MOI", 68);
    expect(g?.code).toBe("101");
    expect(g!.ratio).toBeGreaterThan(0.9);
    expect(g!.secondRatio).toBeLessThan(0.5);
  });

  it("trả null khi bài không khớp mã nào (>80% không đạt)", () => {
    const read = key101.answers.map((v) => (v < 0 ? v : (v + 2) % 4));
    const g = inferCodeFromAnswers(read, MOI, [key101, otherKey()], "MOI", 68);
    expect(g).toBeNull();
  });

  it("bỏ qua mã có quá ít ô đáp án", () => {
    const tiny = { code: "000", answers: [0, 0, 0, ...Array(65).fill(-1)] };
    const read = [0, 0, 0, ...Array(65).fill(-1)];
    const g = inferCodeFromAnswers(read, MOI, [tiny], "MOI", 68);
    expect(g).toBeNull();
    expect(MIN_INFER_CELLS).toBeGreaterThan(3);
  });

  it("so được đáp án của form khác (cùng số câu in) — P1 sai hết thì không nhận", () => {
    const G12 = canonicalSheet({ ansNumber: 108, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true });
    const emptyRead = G12.part1Count ? Array(108).fill(-1) : [];
    const g = inferCodeFromAnswers(emptyRead, G12, [{ code: "132", answers: key101.answers }], "GIAY12", 108);
    expect(g).toBeNull();
  });

  it("phiếu MOI đọc được bài khớp mã GIẤY 12 cùng nội dung → vẫn nhận", () => {
    // Key nhập theo GIAY12 (108 ô) nhưng phiếu đọc là MOI (68 ô): phần chung
    // (P1 20 câu đầu, P2 4 câu, P3 8 câu) khớp thì nhận.
    const g = inferCodeFromAnswers(key101.answers, MOI, [{ code: "101", answers: key101.answers }], "MOI", 68);
    expect(g?.code).toBe("101");
  });

  it("KHÔNG suy ngược khi hai mã đề trùng đáp án (không phân biệt được)", () => {
    // Hai mã cùng đáp án → bài khớp cả hai như nhau; gán bừa sẽ chấm sai mã.
    const twin = { code: "357", answers: key101.answers.slice() };
    const g = inferCodeFromAnswers(key101.answers.slice(), MOI, [key101, twin], "MOI", 68);
    expect(g).toBeNull();
  });

  it("vẫn suy ngược khi mã nhì kém rõ rệt (>15 điểm phần trăm)", () => {
    const read = key101.answers.slice();
    // sai 3 câu P1 (vẫn ≥80%) — mã gốc 0.89, mã khác ~0.2
    for (let i = 0; i < 3; i++) read[i] = (read[i] + 1) % 4;
    const g = inferCodeFromAnswers(read, MOI, [key101, otherKey()], "MOI", 68);
    expect(g?.code).toBe("101");
    expect(g!.ratio - g!.secondRatio).toBeGreaterThan(0.15);
  });

  it("dưới 80% thì KHÔNG suy ngược (sai 6 câu → 78.6%)", () => {
    const read = key101.answers.slice();
    for (let i = 0; i < 6; i++) read[i] = (read[i] + 1) % 4;
    expect(inferCodeFromAnswers(read, MOI, [key101, otherKey()], "MOI", 68)).toBeNull();
  });

  it("phiếu trống hoàn toàn → null", () => {
    const blank = Array(68).fill(-1);
    const g = inferCodeFromAnswers(blank, MOI, [key101], "MOI", 68);
    expect(g).toBeNull();
  });
});
