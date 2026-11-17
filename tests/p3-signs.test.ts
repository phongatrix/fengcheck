/**
 * PHẦN III có ô dấu (− / dấu thập phân) — encoding, import, chấm, hiển thị.
 *
 * Quy luật in trên cả 3 mẫu (Giấy 12 / Giấy 10-11 / QM A4):
 *   ô "−" cùng x cột số 1, cao hơn dòng số 0 đúng 2 bước hàng;
 *   ô "," sau số 1 cùng x cột số 2, ô "," sau số 2 cùng x cột số 3, cao hơn
 *   dòng số 0 đúng 1 bước hàng.
 * Vector đáp án: các ô chữ số giữ nguyên vị trí, ô dấu nằm SAU cùng —
 * mỗi câu có dấu 2 ô [ô −: 0=tô | -1 trống][ô dấu thập phân: 0/1 | -1 trống].
 */

import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import {
  layoutAnswerSlots,
  layoutQuestionCount,
  layoutSignCauCount,
  layoutSlotKind,
  layoutSlotLabels,
  p3ValueOf,
} from "@/lib/omr/giay-layouts";
import {
  answersFromSections,
  normalizeKeyLegacy,
  sectionsFromAnswers,
} from "@/lib/omr/key-sections";
import { gradeGiay } from "@/lib/scoring";
import { parseNumericValue } from "@/lib/smarttest-import";
import type { SheetLayout } from "@/lib/omr/types";

const layout = canonicalSheet({
  ansNumber: 96,
  optionsPerQuestion: 4,
  form: "QM_A4",
  useExamCode: true,
  useStudentCode: true,
});

describe("parseNumericValue — giá trị số có dấu", () => {
  it("-1.1 → chữ số [1,1], dấu −, dấu thập phân sau số 1", () => {
    const r = parseNumericValue("-1.1", 4);
    expect(r).toEqual({ digits: [1, 1, -1, -1], neg: true, comma: 0 });
  });
  it("-2 → chữ số [2], dấu −, không dấu thập phân", () => {
    const r = parseNumericValue("-2", 4);
    expect(r.digits).toEqual([2, -1, -1, -1]);
    expect(r.neg).toBe(true);
    expect(r.comma).toBe(-1);
  });
  it("22 → [2,2]; 1234 → [1,2,3,4]; 1 → [1]", () => {
    expect(parseNumericValue("22", 4).digits).toEqual([2, 2, -1, -1]);
    expect(parseNumericValue("1234", 4).digits).toEqual([1, 2, 3, 4]);
    expect(parseNumericValue("1", 4).digits).toEqual([1, -1, -1, -1]);
  });
  it("dấu phẩy kiểu Việt (1,1) và vị trí sau số 2 (12.3)", () => {
    expect(parseNumericValue("1,1", 4)).toEqual({ digits: [1, 1, -1, -1], neg: false, comma: 0 });
    expect(parseNumericValue("12.3", 4).comma).toBe(1);
  });
  it("quá nhiều chữ số nguyên để tô dấu (123.4) → bỏ dấu thập phân", () => {
    const r = parseNumericValue("123.4", 4);
    expect(r.digits).toEqual([1, 2, 3, 4]);
    expect(r.comma).toBe(-1);
  });
});

describe("layout slots — ô dấu trong vector đáp án", () => {
  it("QM_A4: 96 ô câu + 12 ô dấu (6 câu × 2)", () => {
    expect(layoutQuestionCount(layout)).toBe(96);
    expect(layoutSignCauCount(layout)).toBe(6);
    expect(layoutAnswerSlots(layout)).toBe(108);
  });
  it("slot 96/97 = dấu − / dấu thập phân của câu 1; nhãn hiển thị đúng", () => {
    expect(layoutSlotKind(layout, 96)).toBe("signNeg");
    expect(layoutSlotKind(layout, 97)).toBe("signComma");
    expect(layoutSlotLabels(layout, 96)).toEqual(["−"]);
    expect(layoutSlotLabels(layout, 97)).toEqual([".1", ".2"]);
  });
  it("p3ValueOf: -1.1 / -2 / 22 đúng dạng người dùng nhập", () => {
    const a = Array<number>(108).fill(-1);
    a[72] = 1; a[73] = 1; // câu 1: số 1,1
    a[96] = 0; a[97] = 0; // dấu −, dấu sau số 1
    a[76] = 2; // câu 2: số 2
    a[98] = 0; // dấu −
    a[80] = 2; a[81] = 2; // câu 3: 22
    expect(p3ValueOf(layout, a, 0)).toBe("-1.1");
    expect(p3ValueOf(layout, a, 1)).toBe("-2");
    expect(p3ValueOf(layout, a, 2)).toBe("22");
    expect(p3ValueOf(layout, a, 3)).toBe("-");
  });
});

describe("sections ↔ answers (có ô dấu)", () => {
  it("làm tròn: sections → answers → sections giữ dấu − và dấu thập phân", () => {
    const sections = {
      p1: { 1: 0 },
      p2: {},
      p3: { 1: [1, 1, -1, -1] },
      p3Signs: { 1: { neg: true, comma: 0 } },
    };
    const answers = answersFromSections(sections as never, layout);
    expect(answers.length).toBe(108);
    expect(answers[96]).toBe(0);
    expect(answers[97]).toBe(0);
    const back = sectionsFromAnswers(answers, "QM_A4", 96);
    expect(back.p3Signs[1]).toEqual({ neg: true, comma: 0 });
  });
});

describe("normalizeKeyLegacy — key cũ (dấu chấm chiếm ô chữ số)", () => {
  it("key cũ '-1.1' = [1,-1,1,-1] → [1,1,-1,-1] + ô dấu phẩy sau số 1", () => {
    const oldKey = Array<number>(96).fill(-1);
    oldKey[72] = 1;
    oldKey[73] = -1;
    oldKey[74] = 1;
    const out = normalizeKeyLegacy(oldKey, layout);
    expect(out.length).toBe(108);
    expect(out.slice(72, 76)).toEqual([1, 1, -1, -1]);
    expect(out[96]).toBe(-1); // dấu − không khôi phục được từ key cũ
    expect(out[97]).toBe(0); // dấu thập phân sau số 1
  });
  it("key cũ không có dấu chấm giữ nguyên chữ số", () => {
    const oldKey = Array<number>(96).fill(-1);
    oldKey[72] = 2;
    oldKey[73] = 2;
    const out = normalizeKeyLegacy(oldKey, layout);
    expect(out.slice(72, 76)).toEqual([2, 2, -1, -1]);
    expect(out[96]).toBe(-1);
    expect(out[97]).toBe(-1);
  });
  it("key mới (đã có ô dấu) chạy lại không đổi", () => {
    const key = Array<number>(108).fill(-1);
    key[72] = 1; key[73] = 1;
    key[96] = 0; key[97] = 0;
    expect(normalizeKeyLegacy(key, layout)).toEqual(key);
  });
});

describe("gradeGiay — ô dấu tham gia chấm", () => {
  it("đúng cả chữ số và dấu = đủ điểm PHẦN III", () => {
    const key = Array<number>(108).fill(-1);
    key[72] = 1; key[73] = 1; // câu 1: 1,1
    key[96] = 0; key[97] = 0; // − và dấu sau số 1 → -1.1
    const student = [...key];
    const r = gradeGiay({ p1: 40, p2: 8, p3: 6 }, key, student, { p1: 0, p2: 0, p3: 8 }, { p3SignCau: 6 });
    expect(r.lines[2]).toBe("P3: 4/4=8.00");
    expect(r.totalScore).toBeCloseTo(8.0);
  });
  it("tô thiếu dấu − → mất ô đó (điểm PHẦN III giảm tương ứng)", () => {
    const key = Array<number>(108).fill(-1);
    key[72] = 2; key[73] = 2; // 22
    key[96] = 0; key[97] = 0; // − + dấu sau số 1 → -2.2
    const student = Array<number>(108).fill(-1);
    student[72] = 2; student[73] = 2; // thiếu cả hai ô dấu
    const r = gradeGiay({ p1: 40, p2: 8, p3: 6 }, key, student, { p1: 0, p2: 0, p3: 8 }, { p3SignCau: 6 });
    // PHẦN III tổng 8 điểm chia 4 ô có đáp án: 2 ô số đúng, 2 ô dấu sai
    expect(r.lines[2]).toBe("P3: 2/4=4.00");
    expect(r.totalScore).toBeCloseTo(4.0);
  });
  it("không truyền p3SignCau (key/mẫu cũ) → chấm như trước", () => {
    const key = Array<number>(96).fill(-1);
    key[72] = 5;
    const student = [...key];
    const r = gradeGiay({ p1: 40, p2: 8, p3: 6 }, key, student, { p1: 6, p2: 4, p3: 0 });
    expect(r.lines[2]).toBe("P3: 1/1=0.00");
  });
});
