import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processGray } from "@/lib/omr/pipeline";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";
import { parseSmarttestRows, numericToColumns } from "@/lib/smarttest-import";
import type { FormConfig, FormKind } from "@/lib/omr/types";

function moiForm(): FormConfig {
  const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form: "MOI", useExamCode: true, useStudentCode: false });
  return {
    ansNumber: layoutQuestionCount(layout),
    optionsPerQuestion: 4,
    form: "MOI" as FormKind,
    useExamCode: true,
    useStudentCode: false,
  };
}

describe("Mẫu mới 2025 (moi) round-trip", () => {
  const form = moiForm();

  it("đọc đủ P1 + P2 + P3 và mã đề", () => {
    const layout = canonicalSheet(form);
    const total = layoutQuestionCount(layout);
    expect(total).toBe(68);
    const answers = Array.from({ length: total }, (_, i) => {
      if (i < 20) return i % 4; // P1: A-D
      if (i < 36) return (i + 1) % 2; // P2: Đ/S
      return (i * 3) % 10; // P3 digits
    });
    const gray = renderSheetToGray({ form, answers, examCode: "314", paperWidth: 1300 });
    const res = processGray(gray, { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.examCode).toBe("314");
    expect(res.answers).toEqual(answers);
  });

  it("đọc phiếu tô một phần", () => {
    const layout = canonicalSheet(form);
    const answers = Array<number>(layoutQuestionCount(layout)).fill(-1);
    answers[0] = 3;
    answers[20] = 0; // P2 câu 1 ý a = Đúng
    answers[36] = 7; // P3 câu 1 cột 1 = 7
    const gray = renderSheetToGray({ form, answers, examCode: "001", paperWidth: 1300 });
    const res = processGray(gray, { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.answers?.[0]).toBe(3);
    expect(res.answers?.[20]).toBe(0);
    expect(res.answers?.[36]).toBe(7);
  });
});

describe("Smarttest Excel parser (chambaiV3)", () => {
  const header = ["Câu\\Mã", 1132, 2109, 3157, 4185];
  const rows = [
    header,
    ["1", "B", "A", "C", "A"],
    ["2", "A", "A", "B", "D"],
    ["25", "ĐSĐĐ", "ĐSĐĐ", "ĐSSĐ", "ĐSSĐ"],
    ["26", "ĐSĐS", "ĐSĐS", "ĐSĐĐ", "ĐSĐĐ"],
    ["27", "12.5", "3", "0.5", "125"],
    ["28", "3", "0.5", "125", "7"],
  ];

  it("map đúng phần theo kiểu giá trị vào vector 68 câu", () => {
    const res = parseSmarttestRows(rows as unknown[][], "MOI", 68);
    expect(res.ok).toBe(true);
    expect(res.codes).toEqual(["1132", "2109", "3157", "4185"]);
    expect(res.counts).toEqual({ p1: 2, p2: 2, p3: 2 });
    const k = res.keys[0];
    // P1: câu 1 = B (1), câu 2 = A (0)
    expect(k.answers[0]).toBe(1);
    expect(k.answers[1]).toBe(0);
    // P2: câu 1 ý a-d = Đ S Đ Đ → 0 1 0 0
    expect(k.answers.slice(20, 24)).toEqual([0, 1, 0, 0]);
    // P3: câu 1 = 12.5 → [1, 2, -1, 5]
    expect(k.answers.slice(36, 40)).toEqual([1, 2, -1, 5]);
    // P3: câu 2 = "3" → viết từ trái: [3, -1, -1, -1]
    expect(k.answers.slice(40, 44)).toEqual([3, -1, -1, -1]);

  });

  it("cắt bịt phần vượt mẫu (key phủ đủ không bắt buộc)", () => {
    const many: unknown[][] = [header, ...Array.from({ length: 25 }, (_, i) => [String(i + 1), "A", "B", "C", "D"] as unknown[])];
    const res = parseSmarttestRows(many, "MOI", 68);
    expect(res.ok).toBe(true);
    expect(res.counts).toEqual({ p1: 25, p2: 0, p3: 0 });
    // chỉ 20 câu P1 được map vào mẫu
    expect(res.keys[0].answers.filter((a) => a === 0).length).toBe(20);
    expect(res.keys[0].answers[19]).toBe(0);
    expect(res.keys[0].answers[20]).toBe(-1);
  });

  it("numericToColumns", () => {
    expect(numericToColumns("125", 4)).toEqual([1, 2, 5, -1]);
    expect(numericToColumns("12.5", 4)).toEqual([1, 2, -1, 5]);
    expect(numericToColumns("0.5", 4)).toEqual([0, -1, 5, -1]);
    expect(numericToColumns("-3", 4)).toEqual([3, -1, -1, -1]);
  });
});
