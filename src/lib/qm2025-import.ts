/**
 * Đáp án QM 2025 — 2 định dạng dùng chung cho 2 mẫu giấy (QM_A4 + QM_HSG):
 *
 * 1. Excel "app QM 2025" (mỗi HÀNG = 1 mã đề, cột theo NHÃN):
 *      | Đề\câu | 1..40 | 1a..8d | 1..8 |
 *                 P1       P2       P3
 *    Nhãn cột quyết định phần; nhóm số ĐẦU (trước Đ/S) = P1, nhóm số SAU = P3.
 *    File chỉ điền những câu đề thực sự dùng (vd 18/40, 4/8, 6/8) — phần
 *    còn lại để trống, đúng như phiếu in.
 *
 * 2. QR JSON (chambaiV3 "QM"):
 *      {"đề":"QM","các đề":{"745":{"p1":{...},"p2":{...},"p3":{...}}}}
 *    p1 = {câu: A-D}, p2 = {"(câu,ý)": Đ|S}, p3 = {câu: "giá trị số"}.
 *
 * Cả 2 xuất SmarttestKey[] — vector đáp án map theo mẫu được chọn
 * (câu N của key → phần tương ứng của mẫu, giữ nguyên số thứ tự in trên giấy).
 */

import type { FormKind } from "@/lib/omr/types";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount, layoutSignCauCount } from "@/lib/omr/giay-layouts";
import { numericToAnswerCells } from "./smarttest-import";

export interface SmarttestKey {
  code: string;
  answers: number[];
}

export interface SmarttestParseResult {
  ok: boolean;
  error?: string;
  codes: string[];
  keys: SmarttestKey[];
  counts?: { p1: number; p2: number; p3: number };
}

/** Cấu trúc phần của một mẫu giấy. */
export function formParts(form: FormKind, ansNumber: number): { p1: number; p2: number; p3: number; total: number } {
  // total gồm cả Ô DẤU PHẦN III: mỗi câu có dấu in chiếm 2 ô sau các ô chữ số
  // (MOI không in dấu → không có ô dấu).
  if (form === "QM_A4") return { p1: 40, p2: 8, p3: 6, total: 108 };
  if (form === "GIAY12") return { p1: 40, p2: 8, p3: 6, total: 108 };
  if (form === "GIAY10_11") return { p1: 30, p2: 10, p3: 10, total: 130 };
  if (form === "MOI") return { p1: 20, p2: 4, p3: 8, total: 68 };
  const layout = canonicalSheet({ ansNumber, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
  const total = layoutQuestionCount(layout) + layoutSignCauCount(layout) * 2;
  return { p1: total, p2: 0, p3: 0, total };
}

type QmSections = {
  p1: Record<string, string>;
  p2: Record<string, string>;
  p3: Record<string, string>;
};

/**
 * Map 1 key QM (p1/p2/p3 theo số câu in trên giấy) → vector đáp án của mẫu.
 * p1 câu N → answers[N-1]; p2 câu N ý y → answers[p1 + (N-1)*4 + (y-1)];
 * p3 câu N → 4 cột chữ số → answers[p1 + p2*4 + (N-1)*4 …].
 */
export function qmSectionsToAnswers(
  sections: QmSections,
  form: FormKind,
  ansNumber: number,
): number[] {
  const parts = formParts(form, ansNumber);
  const layout = canonicalSheet({ ansNumber, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
  const total = layoutQuestionCount(layout) + layoutSignCauCount(layout) * 2;
  const answers = Array<number>(total).fill(-1);

  // P1 — câu N (in trên giấy) → answers[N-1]
  for (const [cq, val] of Object.entries(sections.p1)) {
    const n = Number.parseInt(cq, 10);
    if (!Number.isFinite(n) || n < 1 || n > parts.p1) continue;
    const idx = val.trim().toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < 4) answers[n - 1] = idx;
  }
  // P2 — "(N,y)" → answers[p1 + (N-1)*4 + (y-1)]
  for (const [key, val] of Object.entries(sections.p2)) {
    const m = key.match(/\(?\s*(\d+)\s*,\s*([a-dA-D])\s*\)?/);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    const y = m[2].toLowerCase().charCodeAt(0) - 97;
    if (!Number.isFinite(n) || n < 1 || n > parts.p2 || y < 0 || y > 3) continue;
    // "Đ" bị replace thành "D" ở trên; chỉ nhận D/S rõ ràng — giá trị lạ (typo,
    // "Đúng", "1") BỎ QUA thay vì mặc định thành Sai.
    const v = val.trim().toUpperCase().replace(/\u0110/g, "D");
    if (v === "D") answers[parts.p1 + (n - 1) * 4 + y] = 0;
    else if (v === "S") answers[parts.p1 + (n - 1) * 4 + y] = 1;
  }
  // P3 — câu N → 4 cột chữ số + ô dấu (− / dấu thập phân)
  for (const [cq, val] of Object.entries(sections.p3)) {
    const n = Number.parseInt(cq, 10);
    if (!Number.isFinite(n) || n < 1 || n > parts.p3) continue;
    const ci = n - 1;
    const cells = numericToAnswerCells(val, layout, ci);
    cells.digitCells.forEach((v, s) => {
      answers[parts.p1 + parts.p2 * 4 + ci * 4 + s] = v;
    });
    if (cells.signCells.length) {
      const signBase = layoutQuestionCount(layout) + ci * 2;
      cells.signCells.forEach((v, s) => {
        answers[signBase + s] = v;
      });
    }
  }
  return answers;
}

/**
 * Parse Excel QM 2025 (mỗi hàng = 1 mã đề). Nhãn cột quyết định phần:
 *   - nhóm số ĐẦU TIÊN (trước nhãn `Na`) → PHẦN I (ABCD, 1..40)
 *   - nhãn `Na`-`Nd` → PHẦN II (Đ/S từng ý)
 *   - nhóm số SAU nhãn Đ/S → PHẦN III (số)
 */
export function parseQm2025Rows(rows: unknown[][], form: FormKind, ansNumber: number): SmarttestParseResult {
  const grid = rows
    .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c.length > 0));
  if (grid.length < 2) return { ok: false, error: "File không có dữ liệu", codes: [], keys: [] };

  const header = grid[0];
  const codes = header.slice(1).filter((h) => /^\d{1,4}$/.test(h));
  if (codes.length === 0) {
    return { ok: false, error: "Hàng đầu phải là 'Đề\\câu' + các mã đề", codes: [], keys: [] };
  }

  // Phân loại cột theo nhãn + thứ tự:
  //   1..40 → P1 ABCD; Na-Nd → P2 Đ/S; nhóm số SAU Đ/S → P3 (số)
  const labels = header.slice(1);
  let seenDs = false;
  const colKind: ("P3" | "P1" | "P2" | "skip")[] = [];
  const colNum: number[] = [];
  const colY: number[] = [];
  for (const raw of labels) {
    const m = raw.match(/^(\d+)([a-dA-D])$/);
    if (m) {
      seenDs = true;
      colKind.push("P2");
      colNum.push(Number.parseInt(m[1], 10));
      colY.push(m[2].toLowerCase().charCodeAt(0) - 97);
      continue;
    }
    if (/^\d+$/.test(raw)) {
      const n = Number.parseInt(raw, 10);
      // trước nhóm Đ/S → PHẦN I (ABCD); sau → PHẦN III (số)
      colKind.push(seenDs ? "P3" : "P1");
      colNum.push(n);
      colY.push(0);
      continue;
    }
    colKind.push("skip");
    colNum.push(0);
    colY.push(0);
  }
  const p1 = colKind.filter((k) => k === "P1").length;
  const p2 = colKind.filter((k) => k === "P2").length;
  const p3 = colKind.filter((k) => k === "P3").length;

  const parts = formParts(form, ansNumber);
  const layout = canonicalSheet({ ansNumber, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
  const total = layoutQuestionCount(layout) + layoutSignCauCount(layout) * 2;

  // Mỗi HÀNG (sau header) = 1 mã đề
  const keys: SmarttestKey[] = [];
  for (let ri = 1; ri < grid.length; ri++) {
    const row = grid[ri];
    const code = row[0];
    if (!code || !/^\d{1,4}$/.test(code)) continue;
    const answers = Array<number>(total).fill(-1);
    labels.forEach((_, j) => {
      const kind = colKind[j];
      if (kind === "skip") return;
      const v = (row[j + 1] ?? "").trim();
      if (!v) return;
      const n = colNum[j];
      if (kind === "P1" && n >= 1 && n <= parts.p1) {
        const idx = v.toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < 4) answers[n - 1] = idx;
      } else if (kind === "P2" && n >= 1 && n <= parts.p2) {
        const norm = v.toUpperCase().replace(/\u0110/g, "D");
        if (norm === "D" || norm === "S") {
          answers[parts.p1 + (n - 1) * 4 + colY[j]] = norm === "D" ? 0 : 1;
        }
      } else if (kind === "P3" && n >= 1 && n <= parts.p3) {
        const ci = n - 1;
        const cells = numericToAnswerCells(v, layout, ci);
        cells.digitCells.forEach((val, s) => {
          answers[parts.p1 + parts.p2 * 4 + ci * 4 + s] = val;
        });
        // Ô dấu (− / dấu thập phân) nằm sau các ô chữ số của layout.
        if (cells.signCells.length) {
          const signBase = layoutQuestionCount(layout) + ci * 2;
          cells.signCells.forEach((val, s) => {
            answers[signBase + s] = val;
          });
        }
      }
    });
    keys.push({ code, answers });
  }

  if (keys.length === 0) return { ok: false, error: "Không có dòng mã đề nào", codes: keys.map((k) => k.code), keys: [] };
  return { ok: true, codes: keys.map((k) => k.code), keys, counts: { p1, p2, p3 } };
}

/** Parse QR JSON (chambaiV3 "QM") → keys theo mẫu. */
export function parseQmJson(text: string, form: FormKind, ansNumber: number): SmarttestParseResult {
  let obj: {
    "đề"?: string;
    "các đề"?: Record<string, QmSections>;
  };
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: "QR không chứa JSON hợp lệ", codes: [], keys: [] };
  }
  if (!obj || obj["đề"] !== "QM" || !obj["các đề"]) {
    return { ok: false, error: "QR không đúng định dạng key QM", codes: [], keys: [] };
  }
  const cacDe = obj["các đề"] ?? {};
  const codes = Object.keys(cacDe);
  if (codes.length === 0) return { ok: false, error: "QR không có mã đề nào", codes: [], keys: [] };
  const keys: SmarttestKey[] = codes.map((code) => ({
    code,
    answers: qmSectionsToAnswers(cacDe[code], form, ansNumber),
  }));
  const first = cacDe[codes[0]];
  return {
    ok: true,
    codes,
    keys,
    counts: { p1: Object.keys(first.p1 ?? {}).length, p2: Math.ceil(Object.keys(first.p2 ?? {}).length / 4), p3: Object.keys(first.p3 ?? {}).length },
  };
}
