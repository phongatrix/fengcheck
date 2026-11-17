/**
 * Import đáp án định dạng "Smarttest" (chambaiV3): hàng = câu, cột = mã đề.
 *
 *   Câu\Mã | 101  | 102  | ...
 *   1      | A    | B    | ...   → PHẦN I (A-D)
 *   ...    | ĐSĐĐ | ĐSSĐ | ...   → PHẦN II (4 ý a-d, Đúng/Sai)
 *   ...    | 12.5 | 3    | ...   → PHẦN III (số, 4 cột chữ số)
 *
 * Kiểu giá trị quyết định phần; các phần được đánh số Theo Thứ Tự gặp
 * (P1 câu 1,2,…; P2 câu 1,2,…; P3 câu 1,2,…) và map vào vector đáp án
 * của mẫu: [P1 choices, P2 Đ/S subs, P3 digit columns].
 */

import type { FormKind, SheetLayout } from "@/lib/omr/types";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";

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
  /** Số câu bị bỏ vì vượt capacity mẫu (key phủ đầy hơn mẫu). */
  truncated?: number;
}

/**
 * Parse giá trị số "-1.1" thành [4 ô chữ số, dấu −, vị trí dấu thập phân]:
 *   digits — số dồn TRÁI liên tiếp (viết vào 4 cột theo thứ tự ký tự số);
 *   neg    — có dấu trừ trước số;
 *   comma  — vị trí dấu thập phân sau chữ số 1 (0) / sau chữ số 2 (1); số có
 *            quá nhiều chữ số nguyên để tô dấu (vd "123.4") thì bỏ dấu (-1).
 * VD: "-1.1" → { digits [1,1,-1,-1], neg true, comma 0 } — đúng như tô trên
 * mẫu: ô −, ô dấu phẩy sau số 1, số 1 và số 1.
 */
export function parseNumericValue(raw: string, nCols: number): { digits: number[]; neg: boolean; comma: number } {
  const s = raw.trim().replace(",", ".").replace(/\s+/g, "");
  const neg = s.startsWith("-");
  const body = s.replace(/^[-+]/, "");
  const dot = body.indexOf(".");
  const whole = dot >= 0 ? body.slice(0, dot) : body;
  const frac = dot >= 0 ? body.slice(dot + 1) : "";
  const digits: number[] = [];
  for (const ch of whole + frac) {
    const d = Number.parseInt(ch, 10);
    if (Number.isFinite(d)) digits.push(d);
  }
  // KHÔNG cắt bớt chữ số: giá trị không biểu diễn được trong nCols cột (quá
  // nhiều chữ số, hoặc có phần thập phân mà không có chữ số nguyên) phải bị
  // TỪ CHỐI — cắt sẽ âm thầm đổi đáp án ("12.345" → "12.34", ".5" → "5").
  // Trả digits rỗng để nơi gọi bỏ qua giá trị.
  const tooLong = digits.length > nCols;
  const noWhole = dot >= 0 && whole.length === 0;
  if (tooLong || noWhole) return { digits: [], neg, comma: -1 };
  const cells = digits.slice();
  while (cells.length < nCols) cells.push(-1);
  // Dấu thập phân chỉ tô được sau chữ số 1 hoặc sau chữ số 2 (2 ô in trên
  // mẫu) — vị trí khác thì bỏ dấu, chỉ chấm các chữ số.
  const comma = dot >= 0 && whole.length >= 1 && whole.length - 1 <= 1 ? whole.length - 1 : -1;
  return { digits: cells, neg, comma };
}

/** Cấu trúc phần của một mẫu giấy (số câu mỗi phần). */
export function formParts(form: FormKind, ansNumber: number): { p1: number; p2: number; p3: number; total: number } {
  // total = layoutQuestionCount + 2 × số câu PHẦN III có ô dấu (− và dấu thập
  // phân): MỚI không in dấu nên không có ô dấu; ba mẫu còn lại mỗi câu 2 ô.
  if (form === "QM_A4") return { p1: 40, p2: 8, p3: 6, total: 108 };
  if (form === "GIAY12") return { p1: 40, p2: 8, p3: 6, total: 108 };
  if (form === "GIAY10_11") return { p1: 30, p2: 10, p3: 10, total: 130 };
  if (form === "MOI") return { p1: 20, p2: 4, p3: 8, total: 68 };
  const layout = canonicalSheet({ ansNumber, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
  const total = layoutQuestionCount(layout);
  return { p1: total, p2: 0, p3: 0, total };
}

const RE_DS4 = /^[ĐDS]{4}$/i;
const RE_NUM = /^[-+]?\d+([.,]\d+)?$/;

/**
 * "12.5" → giá trị 4 cột chữ số: mỗi ký tự chiếm 1 cột (viết từ trái sang),
 * dấu phẩy/chấm chiếm 1 cột mà bộ đọc không đọc (→ -1); dấu trừ bỏ qua (v1).
 * VD "125" → [1,2,5,-1]; "12.5" → [1,2,-1,5]; "0.5" → [0,-1,5,-1].
 */
export function numericToColumns(raw: string, nCols: number): number[] {
  const body = raw.trim().replace(",", ".").replace(/^[-+]/, "");
  const cells: number[] = [];
  for (const ch of body) {
    if (ch === ".") cells.push(-1);
    else {
      const d = Number.parseInt(ch, 10);
      cells.push(Number.isFinite(d) ? d : -1);
    }
  }
  while (cells.length < nCols) cells.push(-1);
  return cells.slice(0, nCols);
}

/**
 * Chuyển giá trị số "-1.1" vào vector đáp án của MỘT câu PHẦN III:
 *   - mẫu có ô dấu in (neg + dấu thập phân): chữ số dồn trái + ô dấu riêng;
 *   - mẫu không có ô dấu (MOI): kiểu cũ — dấu chấm chiếm một ô chữ số trống.
 * `signBase` là vị trí ô dấu của câu trong vector (sau các ô chữ số), hoặc
 * undefined khi câu không có ô dấu.
 */
export function numericToAnswerCells(
  raw: string,
  layout: SheetLayout,
  cauIndex: number,
): { digitCells: number[]; signCells: number[] } {
  const q = layout.part3[cauIndex];
  if (q?.signs) {
    const { digits, neg, comma } = parseNumericValue(raw, q.columns.length);
    // digits rỗng = giá trị không biểu diễn được trong 4 cột → bỏ cả ô dấu,
    // đừng ghi nửa vời (một đáp án "dở" còn tệ hơn không có).
    if (!digits.length) return { digitCells: [], signCells: [] };
    return { digitCells: digits, signCells: [neg ? 0 : -1, comma] };
  }
  return { digitCells: numericToColumns(raw, q?.columns.length ?? 4), signCells: [] };
}

/**
 * Parse các hàng (đã qua SheetJS `sheet_to_json header:1`).
 * Hàng đầu: ["Câu\Mã", 101, 102, …]. Các hàng sau: [số câu, giá trị…].
 */
export function parseSmarttestRows(
  rows: unknown[][],
  form: FormKind,
  ansNumber: number,
): SmarttestParseResult {
  const grid = rows
    .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c.length > 0));
  if (grid.length < 2) return { ok: false, error: "File không có dữ liệu", codes: [], keys: [] };

  const header = grid[0];
  // Giữ CHỈ SỐ CỘT GỐC của từng mã: bỏ cell không phải mã đề (cột ghi chú,
  // ô trống) rồi đọc giá trị theo đúng cột đó — trước đây lọc xong lại đọc
  // theo vị trí trong mảng đã lọc nên mọi mã sau ô bị bỏ đọc lệch cột.
  const codeCols = header
    .map((h, i) => ({ h, i }))
    .filter((c) => c.i > 0 && /^\d{2,4}$/.test(c.h))
    .map((c) => c.i);
  const codes = codeCols.map((i) => header[i]);
  if (codes.length === 0) {
    return { ok: false, error: "Không thấy hàng mã đề (hàng đầu phải là 'Câu\\Mã' + các mã đề)", codes: [], keys: [] };
  }

  const parts = formParts(form, ansNumber);
  // Duyệt các hàng theo thứ tự, phân loại theo kiểu giá trị của CỘT ĐẦU TIÊN
  // (các cột mã đề cùng kiểu), gán chỉ số phần tăng dần.
  type RowKind = "P1" | "P2" | "P3";
  const rowKinds: RowKind[] = [];
  const rowValues: string[][] = [];
  /** Số câu ghi ở cột 0 của hàng (1-based) — dùng làm CHỈ SỐ, không đếm dồn. */
  const rowStt: number[] = [];
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (const r of grid.slice(1)) {
    const stt = r[0];
    if (!stt || !/^\d+$/.test(stt)) continue;
    const vals = codeCols.map((col) => (r[col] ?? "").trim());
    const first = vals.find((v) => v.length > 0) ?? "";
    const norm = first.toUpperCase().replace(/\u0110/g, "D");
    let kind: RowKind;
    if (RE_DS4.test(norm)) kind = "P2";
    else if (RE_NUM.test(norm)) kind = "P3";
    else if (/^[A-D]$/.test(norm)) kind = "P1";
    else continue;
    if (kind === "P1") p1++;
    if (kind === "P2") p2++;
    if (kind === "P3") p3++;
    rowKinds.push(kind);
    rowValues.push(vals);
    rowStt.push(Number.parseInt(stt, 10));
  }

  if (rowKinds.length === 0) {
    return { ok: false, error: "Không đọc được hàng đáp án nào", codes, keys: [] };
  }
  // Key có thể phủ nhiều câu hơn mẫu (đề dùng ít câu hơn) — cắt bớt phần thừa.
  const truncated = Math.max(0, p1 - parts.p1) + Math.max(0, p2 - parts.p2) + Math.max(0, p3 - parts.p3);

  const layout = canonicalSheet({ ansNumber, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
  const total = layoutQuestionCount(layout);
  /**
   * Chỉ số câu trong từng phần: ưu tiên SỐ CÂU ghi ở cột 0 (1-based) — nhờ vậy
   * một hàng bị BỎ TRỐNG ở mọi mã đề (hoặc giá trị không đọc được) chỉ làm
   * trống đúng câu đó, không đẩy mọi câu sau lệch đi một vị trí như khi đếm
   * dồn các hàng phân loại được.
   */
  const partIndexOf = (kind: RowKind, ri: number): number => {
    const stt = rowStt[ri];
    if (!Number.isFinite(stt) || stt < 1) return -1;
    // Nếu số câu vượt quá số câu của phần (file đánh số liên tục qua các phần)
    // thì lùi về 1-based trong phần.
    const withinPart = stt - 1;
    if (kind === "P1") return withinPart < parts.p1 ? withinPart : -1;
    if (kind === "P2") return withinPart < parts.p2 ? withinPart : -1;
    return withinPart < parts.p3 ? withinPart : -1;
  };

  const keys: SmarttestKey[] = codes.map((code, ci) => {
    const answers = Array<number>(total).fill(-1);
    let p1i = 0;
    let p2i = 0;
    let p3i = 0;
    rowKinds.forEach((kind, ri) => {
      const v = rowValues[ri][ci];
      const norm = v.toUpperCase().replace(/\u0110/g, "D");
      const byLabel = partIndexOf(kind, ri);
      if (kind === "P1") {
        const idx0 = byLabel >= 0 ? byLabel : p1i < parts.p1 ? p1i : -1;
        if (idx0 >= 0) {
          const idx = norm.charCodeAt(0) - 65;
          if (idx >= 0 && idx < 4) answers[idx0] = idx;
        }
        p1i++;
      } else if (kind === "P2") {
        const idx0 = byLabel >= 0 ? byLabel : p2i < parts.p2 ? p2i : -1;
        if (idx0 >= 0) {
          // 4 ký tự Đ/S → 4 ý a-d
          for (let s = 0; s < 4 && norm.length >= 4; s++) {
            answers[parts.p1 + idx0 * 4 + s] = norm[s] === "D" ? 0 : 1;
          }
        }
        p2i++;
      } else {
        const idx0 = byLabel >= 0 ? byLabel : p3i < parts.p3 ? p3i : -1;
        if (idx0 >= 0) {
          const cells = numericToAnswerCells(v, layout, idx0);
          if (cells.digitCells.length) {
            cells.digitCells.forEach((val, s) => {
              answers[parts.p1 + parts.p2 * 4 + idx0 * 4 + s] = val;
            });
            // Ô dấu nằm sau các ô chữ số của layout (theo thứ tự câu).
            if (cells.signCells.length) {
              const signBase = layoutQuestionCount(layout) + idx0 * 2;
              cells.signCells.forEach((val, s) => {
                answers[signBase + s] = val;
              });
            }
          }
        }
        p3i++;
      }
    });
    return { code, answers };
  });

  return { ok: true, codes, keys, counts: { p1, p2, p3 }, truncated };
}
