/**
 * Đáp án dạng PHẦN (không phụ thuộc mẫu giấy) — để MỘT mã đề ráp được lên cả
 * hai mẫu dùng chung (QM_A4 và Giấy 10-11 HSG) dù số câu mỗi phần khác nhau.
 *
 * Vector phẳng `answers` của một form có thứ tự cố định:
 *   [ P1 câu 1..N | P2 câu 1..M × 4 ý | P3 câu 1..K × 4 chữ số | P3 ô dấu ]
 * Ô dấu: mỗi câu PHẦN III có dấu in (neg + dấu thập phân) chiếm 2 ô liên tiếp
 * sau các ô chữ số, theo thứ tự câu: [0 = tô dấu − | -1 trống][0/1 = vị trí
 * dấu phẩy sau số 1/số 2 | -1 trống]. Mẫu không có dấu in (MOI) không có ô này.
 * Tách ra thành:
 *   p1: { số câu in trên giấy → 0..3 }
 *   p2: { "N,y" → 0 = Đúng, 1 = Sai }
 *   p3: { số câu → [4 chữ số, -1 = ô trống] }
 *   p3Signs: { số câu → { neg: tô dấu −, comma: 0/1 = dấu phẩy sau số 1/2 } }
 */

import type { Bubble, FormKind, SheetLayout } from "./types";
import { canonicalSheet } from "./sheet";
import { layoutQuestionCount, layoutSignCauCount, normalizeKeyLegacy } from "./giay-layouts";

export interface P3SignSection {
  neg?: boolean;
  /** Dấu thập phân sau chữ số 1 (0) hoặc sau chữ số 2 (1). */
  comma?: 0 | 1;
}

export interface KeySections {
  p1: Record<number, number>;
  p2: Record<string, number>;
  p3: Record<number, number[]>;
  p3Signs: Record<number, P3SignSection>;
}

/** Số câu mỗi phần của một layout (P2 tính theo câu, không theo ý). */
export function sectionCounts(layout: SheetLayout): { p1: number; p2: number; p3: number } {
  return {
    p1: layout.part1Count,
    p2: Math.round(layout.part2Count / 4),
    p3: layout.part3.length,
  };
}

/** Vector phẳng của một form → các phần theo số câu in trên giấy. */
export function sectionsFromAnswers(answers: number[], form: FormKind, ansNumber: number): KeySections {
  return sectionsFromLayout(
    answers,
    canonicalSheet({ ansNumber, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true }),
  );
}

/**
 * Như trên nhưng nhận layout đã có (tránh dựng lại).
 *
 * `opts.normalize = false` cho vector ĐỌC TỪ PHIẾU: chuẩn hoá encoding cũ
 * (dấu chấm chiếm ô chữ số → dồn chữ số) chỉ đúng cho ĐÁP ÁN CHUẨN lưu trước
 * kia; áp lên bài đọc làm ô trống giữa các chữ số bị hiểu thành dấu chấm và
 * chữ số bị dồn — đọc sai giá trị PHẦN III (vd "1_0" thành "1.0").
 */
export function sectionsFromLayout(
  rawAnswers: number[],
  layout: SheetLayout,
  opts: { normalize?: boolean } = {},
): KeySections {
  const normalize = opts.normalize !== false;
  // Key lưu trước khi có ô dấu (encoding cũ: dấu chấm chiếm 1 ô chữ số, thiếu
  // ô dấu ở cuối vector) → chuẩn hoá trước khi tách, để MỌI nơi dùng sections
  // (lớp phủ đáp án, quy đổi mẫu, worker) đều đúng vị trí chữ số và ô dấu.
  const answers = normalize ? normalizeKeyLegacy(rawAnswers, layout) : rawAnswers;
  const parts = sectionCounts(layout);
  const s: KeySections = { p1: {}, p2: {}, p3: {}, p3Signs: {} };

  for (let n = 1; n <= parts.p1; n++) {
    const v = answers[n - 1];
    if (v !== undefined && v >= 0) s.p1[n] = v;
  }
  for (let n = 1; n <= parts.p2; n++) {
    for (let y = 0; y < 4; y++) {
      const v = answers[parts.p1 + (n - 1) * 4 + y];
      if (v !== undefined && v >= 0) s.p2[`${n},${y}`] = v;
    }
  }
  // Ô dấu nằm SAU các ô chữ số: mỗi câu có dấu chiếm [ô −, ô dấu thập phân].
  const signBase = layoutQuestionCount(layout);
  let signIdx = 0;
  for (let n = 1; n <= parts.p3; n++) {
    const base = parts.p1 + parts.p2 * 4 + (n - 1) * 4;
    const q = layout.part3[n - 1];
    const digits: number[] = [];
    for (let k = 0; k < 4; k++) {
      const v = answers[base + k];
      digits.push(v === undefined ? -1 : v);
    }
    if (digits.some((d) => d >= 0)) s.p3[n] = digits;
    if (q?.signs) {
      const neg = answers[signBase + signIdx * 2];
      const comma = answers[signBase + signIdx * 2 + 1];
      const sec: P3SignSection = {};
      if (neg === 0) sec.neg = true;
      if (comma === 0 || comma === 1) sec.comma = comma as 0 | 1;
      if (sec.neg || sec.comma !== undefined) s.p3Signs[n] = sec;
      signIdx++;
    }
  }
  return s;
}

export type MarkKind = "p1" | "p2" | "p3" | "exam" | "student";

export interface OverlayMark {
  /** Toạ độ chuẩn hoá (x/pageW, y/pageH) + bán kính / min(pageW,pageH). */
  bubble: Bubble;
  kind: MarkKind;
  label: string;
}

/**
 * Sinh danh sách dấu cần tô lên một layout cụ thể.
 * Câu nào mẫu không có (mẫu ngắn hơn đáp án) thì bỏ qua.
 */
export function marksForLayout(
  layout: SheetLayout,
  sections: KeySections,
  opts: { examCode?: string; studentCode?: string } = {},
): OverlayMark[] {
  const marks: OverlayMark[] = [];

  // PHẦN I — câu N ↔ questions[N-1]
  for (const [key, opt] of Object.entries(sections.p1)) {
    const n = Number(key);
    if (n < 1 || n > layout.part1Count) continue;
    const b = layout.questions[n - 1]?.bubbles[opt];
    if (b) marks.push({ bubble: b, kind: "p1", label: `Câu ${n}` });
  }

  // PHẦN II — câu N ý y ↔ questions[part1Count + (N-1)*4 + y]
  for (const [key, val] of Object.entries(sections.p2)) {
    const m = key.match(/^(\d+),(\d)$/);
    if (!m) continue;
    const n = Number(m[1]);
    const y = Number(m[2]);
    if (n < 1 || n > layout.part2Count / 4) continue;
    const b = layout.questions[layout.part1Count + (n - 1) * 4 + y]?.bubbles[val === 1 ? 1 : 0];
    if (b) marks.push({ bubble: b, kind: "p2", label: `Câu ${n}${"abcd"[y]}` });
  }

  // PHẦN III — câu N, cột chữ số s ↔ part3[N-1].columns[s]
  for (const [key, digits] of Object.entries(sections.p3)) {
    const n = Number(key);
    const q = layout.part3[n - 1];
    if (!q) continue;
    digits.forEach((d, s) => {
      if (d < 0) return;
      const b = q.columns[s]?.bubbles[d];
      if (b) marks.push({ bubble: b, kind: "p3", label: `Câu ${n}` });
    });
  }

  // PHẦN III — ô dấu: dấu − và dấu thập phân của câu có in dấu.
  let signIdx = 0;
  for (const q of layout.part3) {
    signIdx++;
    const sec = sections.p3Signs[signIdx];
    if (!q.signs || !sec) continue;
    if (sec.neg) marks.push({ bubble: q.signs.neg, kind: "p3", label: `Câu ${signIdx} (−)` });
    if (sec.comma !== undefined) {
      const b = sec.comma === 0 ? q.signs.comma1 : q.signs.comma2;
      marks.push({ bubble: b, kind: "p3", label: `Câu ${signIdx} (,)` });
    }
  }

  // Mã đề / Số báo danh — điền chữ số từ cột trái (căn phải như khi tô tay).
  const fillCode = (block: SheetLayout["examCode"], code: string | undefined, kind: MarkKind) => {
    if (!block || !code) return;
    const digits = code.replace(/\D/g, "");
    const pad = block.columns.length - digits.length;
    if (pad < 0) return;
    block.columns.forEach((col, i) => {
      if (i < pad) return;
      const b = col.bubbles[Number(digits[i - pad])];
      if (b) marks.push({ bubble: b, kind, label: kind === "exam" ? "Mã đề" : "SBD" });
    });
  };
  fillCode(layout.examCode, opts.examCode, "exam");
  fillCode(layout.studentCode, opts.studentCode, "student");

  return marks;
}

/**
 * Chiều ngược lại: sections → vector đáp án đúng thứ tự của MỘT layout cụ thể.
 * Dùng khi chấm: cùng một mã đề áp cho cả mẫu QM_A4 (40/8/6) và mẫu HSG
 * (30/10/10) mà không phải nhập lại đáp án.
 */
export function answersFromSections(sections: KeySections, layout: SheetLayout): number[] {
  const total = layoutQuestionCount(layout) + layoutSignCauCount(layout) * 2;
  const answers = Array<number>(total).fill(-1);

  for (const [key, opt] of Object.entries(sections.p1)) {
    const n = Number(key);
    if (n >= 1 && n <= layout.part1Count) answers[n - 1] = opt;
  }
  for (const [key, val] of Object.entries(sections.p2)) {
    const m = key.match(/^(\d+),(\d)$/);
    if (!m) continue;
    const n = Number(m[1]);
    const y = Number(m[2]);
    if (n < 1 || n > layout.part2Count / 4) continue;
    answers[layout.part1Count + (n - 1) * 4 + y] = val;
  }
  for (const [key, digits] of Object.entries(sections.p3)) {
    const n = Number(key);
    if (n < 1 || n > layout.part3.length) continue;
    const base = layout.part1Count + layout.part2Count + (n - 1) * 4;
    digits.forEach((d, s) => {
      if (base + s < total) answers[base + s] = d;
    });
  }
  // Ô dấu PHẦN III: [ô −, ô dấu thập phân] mỗi câu có dấu in.
  let signIdx = 0;
  for (const q of layout.part3) {
    const sec = sections.p3Signs[signIdx + 1];
    if (q.signs) {
      const base = layoutQuestionCount(layout) + signIdx * 2;
      answers[base] = sec?.neg ? 0 : -1;
      answers[base + 1] = sec?.comma !== undefined ? sec.comma : -1;
      signIdx++;
    }
  }
  return answers;
}

export { normalizeKeyLegacy };
