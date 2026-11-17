/**
 * TRỌNG TÀI CẶP SONG SINH MOI ↔ Giấy 10-11.
 *
 * Hai lưới này quá giống nhau: lưới MOI đọc phiếu Giấy 10-11 vẫn ra đúng mã đề
 * và phần lớn đáp án (điểm vành thuần gần hoà nhau). Trên ảnh chụp TỐI, điểm
 * vành của lưới thật còn tụt dưới lưới sai (đo 5 ảnh thật 11a8: G10_11 0.155,
 * MOI 0.283) nên không thể dựa vào vành — phải có trọng tài:
 *  1. tỉ lệ khớp KEY của đáp án đọc được (lưới thật luôn cao hơn lưới sai
 *     ≥5 điểm phần trăm — đo trên ảnh thật);
 *  2. hoà hoặc không có key → điểm vành thuần readRing (margin 1.15).
 * Khoá hành vi: phiếu Giấy 10-11 khai báo nhầm MOI vẫn phải đọc bằng GIAY10_11.
 */
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processWithFormDetection } from "@/lib/omr/form-detect";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { layoutQuestionCount, layoutAnswerSlots } from "@/lib/omr/giay-layouts";
import type { KeyLike } from "@/lib/omr/code-infer";
import type { FormConfig } from "@/lib/omr/types";

function giay1011Form(): FormConfig {
  const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form: "GIAY10_11", useExamCode: true, useStudentCode: false });
  return {
    ansNumber: layoutQuestionCount(layout),
    optionsPerQuestion: 4,
    form: "GIAY10_11",
    useExamCode: true,
    useStudentCode: false,
  };
}

const form = giay1011Form();
const layout = canonicalSheet(form);
const signBase = layoutQuestionCount(layout);
/** Đáp án mẫu: P1 xoay vòng A–D, P2 Đ/S luân phiên, P3 chữ số.any — đủ dày để key_ratio phân biệt. */
const answers = Array.from({ length: layoutAnswerSlots(layout) }, (_, i) => {
  if (i < layout.part1Count) return i % 4;
  if (i < layout.questions.length) return i % 2;
  if (i < signBase) return (i * 7) % 10;
  return -1;
});
const gray = renderSheetToGray({ form, answers, examCode: "132", paperWidth: 1600 });
const keys: KeyLike[] = [{ code: "132", answers: [...answers] }];

describe("trọng tài cặp song sinh MOI ↔ Giấy 10-11", { timeout: 300_000 }, () => {
  it("khai báo đúng GIAY10_11 + key khớp → giữ nguyên mẫu", () => {
    const res = processWithFormDetection(gray, form, { checkSharpness: false, keys });
    expect(res.formUsed).toBe("GIAY10_11");
    expect(res.formSwitched).toBe(false);
    expect(res.examCode).toBe("132");
  });

  it("khai báo nhầm MOI trên phiếu Giấy 10-11 → trọng tài về đúng GIAY10_11", () => {
    const res = processWithFormDetection(gray, { ...form, form: "MOI" }, { checkSharpness: false, keys });
    expect(res.formUsed).toBe("GIAY10_11");
    expect(res.formSwitched).toBe(true);
  });
});
