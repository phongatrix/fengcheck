/**
 * Cấu hình điểm của một bài thi: điểm từng PHẦN + điểm từng CÂU.
 *
 * Hai đơn vị được lưu tách biệt:
 *   - `partMax`: điểm tổng của từng phần. Mẫu Giấy 12 / Giấy 10-11 luôn có
 *     3 phần [P1, P2, P3]; phiếu thường (A4/A6/A8/MOI) là các phần của
 *     "thang điểm" (vd "4,6" → 2 phần).
 *   - `perCau`: điểm riêng từng câu, theo KHÔNG GIAN CÂU (P1 câu 1..N, P2 câu
 *     1..M, P3 câu 1..K) — không phải theo ô in. PHẦN II mỗi câu có 4 ý a–d,
 *     PHẦN III mỗi câu có 4 cột chữ số: điểm câu được chia đều cho các ô đó.
 *
 * Điểm từng câu là TƯƠNG ĐỐI trong mỗi phần: công thức chấm chuẩn hoá theo
 * tổng trọng số các câu ĐÁP ÁN CÓ, nên tổng điểm phần luôn đúng bằng `partMax`.
 */

import type { QuizRecord } from "./db";
import type { FormKind, SheetLayout } from "./omr/types";
import { GIAY_FORMS } from "./omr/types";
import { parsePartMaxes, parsePointLadder, splitGiayTotal, type ScorePart } from "./scoring";

export type CauCounts = { p1: number; p2: number; p3: number };

/** Số câu mỗi phần theo KHÔNG GIAN CÂU của layout (P2 tính theo câu, không theo ý). */
export function cauCountsOf(layout: SheetLayout): CauCounts {
  return {
    p1: layout.part1Count,
    p2: Math.round(layout.part2Count / 4),
    p3: layout.part3.length,
  };
}

/**
 * Số câu mỗi phần của form đáp án (khác layout khi phiếu là mẫu còn lại).
 *
 * `partCount` người dùng đặt trong Thiết lập điểm được ưu tiên: phiếu in 40 ô
 * PHẦN I nhưng đề chỉ dùng 24 câu thì chấm trên 24 (không trừ oan 16 câu trống).
 * Số câu đọc được không thể vượt quá số ô in của mẫu — vượt thì kẹp lại.
 */
export function cauCountsForQuiz(quiz: QuizRecord, layout: SheetLayout | null): CauCounts {
  const base = layoutCounts(quiz, layout);
  const custom = quiz.points?.partCount;
  if (!custom?.length) return base;
  const pick = (i: number, fallback: number) => {
    const v = custom[i];
    // 0 / rỗng / không phải số = "không đặt" → dùng số câu của mẫu. Trước đây
    // 0 được nhận nguyên nên xoá trắng ô "Số lượng câu" làm cả phần thành 0/0
    // và học sinh mất trắng điểm phần đó.
    if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return fallback;
    return Math.min(Math.round(v), fallback);
  };
  return {
    p1: pick(0, base.p1),
    p2: pick(1, base.p2),
    p3: pick(2, base.p3),
  };
}

/** Số câu theo MẪU in (bỏ qua cấu hình riêng của người dùng). */
function layoutCounts(quiz: QuizRecord, layout: SheetLayout | null): CauCounts {
  if (GIAY_FORMS.includes(quiz.form as FormKind)) {
    if (layout && layout.kind === (quiz.form as FormKind)) return cauCountsOf(layout);
    // Không có layout (trang chưa dựng xong) — số câu cố định của từng mẫu.
    const fixed: Record<string, CauCounts> = {
      GIAY12: { p1: 40, p2: 8, p3: 6 },
      GIAY10_11: { p1: 30, p2: 10, p3: 10 },
      QM_A4: { p1: 40, p2: 8, p3: 6 },
      MOI: { p1: 20, p2: 4, p3: 8 },
    };
    return fixed[quiz.form] ?? { p1: quiz.ansNumber, p2: 0, p3: 0 };
  }
  return { p1: quiz.ansNumber, p2: 0, p3: 0 };
}

export function totalCau(c: CauCounts): number {
  return c.p1 + c.p2 + c.p3;
}

/**
 * THANG ĐIỂM CHUẨN của hai mẫu Giấy — dùng CHUNG một công thức cho Giấy 12 và
 * Giấy 10-11 (theo yêu cầu: "mẫu 10_11 tính giống mẫu 12"):
 *
 *   P1 = số câu × 0.25 điểm
 *   P2 = thang luỹ tiến theo số ý đúng, tối đa 1 điểm/câu
 *        (1 ý 0.1 · 2 ý 0.25 · 3 ý 0.5 · 4 ý 1.0)
 *   P3 = số câu × 0.5 điểm (chia đều cho 4 ô chữ số + ô dấu của câu)
 *   Tổng = P1 + P2 + P3
 *
 * Tính trên số câu ĐÁP ÁN CÓ: mẫu in 8 câu Đ/S nhưng đề dùng 3 câu thì P2 tối
 * đa = 3 điểm (không pha loãng theo số ô in).
 */
export const GIAY_P1_PER_CAU = 0.25;
export const GIAY_P2_PER_CAU = 1;
export const GIAY_P3_PER_CAU = 0.5;
/** Thang 4 mức của MỘT câu PHẦN II (1/2/3/4 ý đúng). */
export const GIAY_P2_LADDER = [0.1, 0.25, 0.5, 1] as const;

/** Thang điểm mặc định của mẫu Giấy, tính theo số câu từng phần. */
export function giayStandardMaxes(cau: CauCounts): { p1: number; p2: number; p3: number } {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    p1: round(cau.p1 * GIAY_P1_PER_CAU),
    p2: round(cau.p2 * GIAY_P2_PER_CAU),
    p3: round(cau.p3 * GIAY_P3_PER_CAU),
  };
}

/** Nhãn hiển thị cho từng câu trong không gian câu. */
export function cauLabels(c: CauCounts): string[] {
  const out: string[] = [];
  for (let n = 1; n <= c.p1; n++) out.push(`Câu ${n}`);
  for (let n = 1; n <= c.p2; n++) out.push(`Câu ${n} (a–d)`);
  for (let n = 1; n <= c.p3; n++) out.push(`Câu ${n} (4 số)`);
  return out;
}

export interface QuizPoints {
  /** Điểm tổng từng phần: giấy = [P1, P2, P3]; phiếu thường = các phần thang điểm. */
  partMax: number[];
  /** Số lượng câu từng phần người dùng đặt (mặc định = số câu của mẫu). */
  partCount?: number[] | null;
  /** Điểm từng ý a–d của PHẦN II (dùng chung mọi câu). */
  p2Sub?: number[] | null;
  /** Điểm từng ý RIÊNG từng câu PHẦN II — mỗi dòng một mảng 4 số. */
  p2Row?: number[][] | null;
  /** Điểm riêng từng câu (không gian câu); null = chia đều. */
  perCau?: (number | null)[] | null;
}

/** Cấu hình điểm hiện hành, suy ra từ `points` hoặc thang điểm cũ. */
export function pointsOf(quiz: QuizRecord, layout: SheetLayout | null, defaultMax = 10): QuizPoints {
  const isGiay = GIAY_FORMS.includes(quiz.form as FormKind);
  const fromDb = quiz.points;
  if (fromDb && Array.isArray(fromDb.partMax) && fromDb.partMax.length > 0) {
    let partMax = fromDb.partMax.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0));
    // Dữ liệu cũ: phiếu 3 phần mà chỉ lưu MỘT số → số đó là tổng cả bài.
    // (Trước đây parser còn tự thêm P2 = 4, nên bài 40 câu hiện 0.25đ/câu và
    // tổng 14.) Chuẩn hoá lại để mở Thiết lập điểm là thấy giá trị đúng.
    if (isGiay && partMax.length === 1) {
      const [p1, p2, p3] = splitGiayTotal(partMax[0]);
      partMax = [p1, p2, p3];
    }
    return {
      partMax,
      partCount: fromDb.partCount?.length ? fromDb.partCount.map((v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)) : null,
      p2Sub: fromDb.p2Sub?.length ? fromDb.p2Sub.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0)) : null,
      p2Row: fromDb.p2Row?.length
        ? fromDb.p2Row.map((row) => (Array.isArray(row) ? row.slice(0, 4).map((v) => (Number.isFinite(v) && v >= 0 ? v : 0)) : [0, 0, 0, 0]))
        : null,
      perCau: fromDb.perCau?.length ? fromDb.perCau.map((v) => (v === null || !Number.isFinite(v) ? null : v)) : null,
    };
  }
  if (isGiay) {
    /**
     * THANG CHUẨN CỦA MẪU GIẤY: P1 = số câu × 0.25, P2 = 1đ/câu, P3 = 0.5đ/câu
     * — DÙNG CHUNG cho Giấy 12 và Giấy 10-11.
     *
     * Khi nào dùng chuẩn thay vì `pointLadder`:
     *  - thang trống;
     *  - thang còn là giá trị MẶC ĐỊNH CŨ của app ("6,4,0" / "10") — không
     *    phải lựa chọn của người dùng mà là dữ liệu do app tự điền ở bản trước,
     *    và "6,4,0" cho 40 câu nghĩa là 0.15đ/câu (không phải 0.25 như quy định).
     * Thang KHÁC hai giá trị đó vẫn được tôn trọng (người dùng chủ động nhập).
     */
    const ladder = (quiz.pointLadder ?? "").trim();
    const isLegacyDefault = ladder === "" || ladder === "10" || ladder === "6,4,0" || ladder === "6, 4, 0";
    if (isLegacyDefault) {
      const m = giayStandardMaxes(cauCountsForQuiz(quiz, layout));
      return { partMax: [m.p1, m.p2, m.p3], perCau: null };
    }
    const m = parsePartMaxes(ladder);
    return { partMax: [m.p1, m.p2, m.p3], perCau: null };
  }
  const parts = quiz.pointLadder ? parsePointLadder(quiz.pointLadder, quiz.ansNumber) : null;
  return { partMax: parts ? parts.map((p) => p.maxScore) : [defaultMax], perCau: null };
}

/**
 * Trải điểm từng câu thành trọng số cho TỪNG Ô của vector đáp án của một layout
 * cụ thể. Thứ tự ô: [P1 câu][P2 câu × 4 ý][P3 câu × 4 cột] — giống hệt
 * `answers` của reader, nên dùng thẳng được cho `scorePart`.
 *
 * `src` là số câu của form đã nhập điểm; `dst` là số câu của phiếu vừa đọc
 * (hai mẫu dùng chung khác số câu mỗi phần). Câu số N ở phần nào cũng tra đúng
 * vị trí của nó trong `perCau`.
 */
export function cellWeightsFor(
  perCau: (number | null)[],
  src: CauCounts,
  /** Số câu IN của layout vừa đọc — quyết định ĐỘ DÀI vector (offset từng phần). */
  dst: CauCounts,
  /** Số câu PHẦN III có ô dấu in (2 ô/câu) — câu có dấu chia đều cho 6 ô. */
  signCau = 0,
  /**
   * Số câu CẦN CHẤM (Thiết lập điểm, có thể ít hơn số ô in). Câu ngoài phạm vi
   * chấm không được chấm nên trọng số 1. Bỏ trống ⇒ chấm toàn bộ ô in.
   */
  grade?: CauCounts,
): number[] {
  const g = grade ?? dst;
  const w = (index: number, valid: boolean) => {
    if (!valid) return 1; // câu không có trong form đã nhập điểm → trọng số 1
    const v = perCau[index];
    return v !== null && v !== undefined && Number.isFinite(v) && v > 0 ? v : 1;
  };
  const cells: number[] = [];
  for (let n = 0; n < dst.p1; n++) cells.push(n < g.p1 ? w(n, n < src.p1) : 1);
  for (let n = 0; n < dst.p2; n++) {
    const cw = n < g.p2 ? w(src.p1 + n, n < src.p2) : 1;
    for (let y = 0; y < 4; y++) cells.push(cw / 4);
  }
  const signCount = Math.min(signCau, dst.p3);
  for (let n = 0; n < dst.p3; n++) {
    const cw = n < g.p3 ? w(src.p1 + src.p2 + n, n < src.p3) : 1;
    // Câu CÓ ô dấu: tổng trọng số của câu vẫn là cw, chia cho 6 ô (4 chữ số +
    // 2 ô dấu) — trước đây 4 ô chữ số cw/4 + 2 ô dấu cw/2 → câu nặng GẤP ĐÔI.
    const per = n < signCount ? cw / 6 : cw / 4;
    for (let s = 0; s < 4; s++) cells.push(per);
  }
  // Ô dấu (− / dấu thập phân) theo từng câu, sau các ô chữ số.
  for (let n = 0; n < signCount; n++) {
    const cw = n < g.p3 ? w(src.p1 + src.p2 + n, n < src.p3) : 1;
    cells.push(cw / 6, cw / 6);
  }
  return cells;
}

/**
 * Thang điểm gửi xuống worker: giấy dùng "p1,p2,p3"; phiếu thường dùng danh
 * sách phần (chia đều số câu nếu nhiều phần, như `parsePointLadder`).
 */
export interface GradeConfig {
  isSplit?: boolean;
  parts?: ScorePart[] | null;
  maxScore?: number;
  ladder?: string;
  /** Điểm từng câu ĐÃ ĐIỀN ĐỦ (null đã thay bằng điểm chia đều). */
  perCau?: number[] | null;
  /** Điểm từng ý a–d của PHẦN II (ưu tiên hơn perCau khi chấm P2). */
  p2Sub?: number[] | null;
  /** Điểm từng ý riêng từng câu PHẦN II (ưu tiên hơn p2Sub). */
  p2Row?: number[][] | null;
  cauCounts?: CauCounts | null;
}

/**
 * Điền các câu bỏ trống (null) bằng điểm chia đều của phần chứa nó.
 * Nhờ vậy phía chấm chỉ phải làm việc với mảng số đầy đủ.
 */
export function resolvePerCau(
  perCau: (number | null)[] | null | undefined,
  partMax: number[],
  quiz: QuizRecord,
  cau: CauCounts,
): number[] {
  const n = totalCau(cau);
  const out = Array.from({ length: n }, () => 0);
  if (cau.p2 + cau.p3 > 0) {
    const ranges: [number, number, number][] = [
      [0, cau.p1, parseNumOr(partMax[0], 0)],
      [cau.p1, cau.p1 + cau.p2, parseNumOr(partMax[1], 0)],
      [cau.p1 + cau.p2, n, parseNumOr(partMax[2], 0)],
    ];
    for (const [from, to, max] of ranges) {
      const auto = to > from ? max / (to - from) : 0;
      for (let i = from; i < to; i++) {
        const v = perCau?.[i];
        out[i] = v !== null && v !== undefined && Number.isFinite(v) ? v : auto;
      }
    }
    return out;
  }
  // Phiếu thường: các phần chia đều số câu (giống `distribute`).
  const parts = distribute(quiz.ansNumber, partMax.length ? partMax : [10]);
  let from = 0;
  for (const p of parts) {
    const to = Math.min(n, from + p.count);
    const auto = p.count > 0 ? p.maxScore / p.count : 0;
    for (let i = from; i < to; i++) {
      const v = perCau?.[i];
      out[i] = v !== null && v !== undefined && Number.isFinite(v) ? v : auto;
    }
    from = to;
  }
  return out;
}

function parseNumOr(v: number | undefined, fallback: number): number {
  return Number.isFinite(v) && (v as number) >= 0 ? (v as number) : fallback;
}

/**
 * Trọng số từng câu có THAY ĐỔI trong phần nào không (ô trống = điểm chia đều,
 * nên phải so với giá trị chia đều chứ không chỉ so giữa các ô đã nhập).
 * Trọng số đều cho kết quả y hệt công thức gốc, nên bỏ qua để điểm phần vẫn
 * chia theo số Ô in như trước (`keyDefinedTotal`).
 */
function hasVariation(resolved: number[], c: CauCounts): boolean {
  const ranges: [number, number][] = [
    [0, c.p1],
    [c.p1, c.p1 + c.p2],
    [c.p1 + c.p2, c.p1 + c.p2 + c.p3],
  ];
  for (const [from, to] of ranges) {
    if (to - from < 2) continue;
    const vals = resolved.slice(from, to);
    if (Math.max(...vals) - Math.min(...vals) > 0.0005) return true;
  }
  return false;
}

export function gradeConfigOf(
  quiz: QuizRecord,
  layout: SheetLayout | null,
  opts: { isSplit: boolean; defaultMax: number },
): GradeConfig {
  const isGiay = GIAY_FORMS.includes(quiz.form as FormKind);
  const points = pointsOf(quiz, layout, opts.defaultMax);
  const cauCounts = cauCountsForQuiz(quiz, layout);
  // Chỉ gửi trọng số khi THỰC SỰ có câu khác điểm các câu còn lại.
  const resolved =
    points.perCau && points.perCau.length >= totalCau(cauCounts)
      ? resolvePerCau(points.perCau, points.partMax, quiz, cauCounts)
      : null;
  const perCau = resolved && hasVariation(resolved, cauCounts) ? resolved : null;
  // PHẦN II chấm theo từng ý a–d (1 ý = p2Sub[0] … 4 ý = p2Sub[3] mức điểm/ý).
  // p2Row (điểm riêng từng dòng/câu) ưu tiên hơn p2Sub khi có.
  const p2Sub = points.p2Sub?.length === 4 ? points.p2Sub : null;
  const p2Row = points.p2Row?.length ? points.p2Row : null;

  if (isGiay) {
    return {
      ladder: points.partMax.slice(0, 3).join(","),
      perCau,
      p2Sub,
      p2Row,
      cauCounts,
    };
  }
  const parts =
    points.partMax.length > 1
      ? distribute(quiz.ansNumber, points.partMax)
      : null;
  return {
    isSplit: opts.isSplit,
    parts,
    maxScore: points.partMax[0] ?? opts.defaultMax,
    perCau,
    cauCounts,
  };
}

/** Chia `count` câu cho các phần theo điểm — giống `parsePointLadder`. */
export function distribute(count: number, partMax: number[]): ScorePart[] {
  const base = Math.floor(count / partMax.length);
  const rest = count % partMax.length;
  return partMax.map((maxScore, i) => ({
    maxScore,
    count: base + (i < rest ? 1 : 0),
  }));
}

/** Điểm mỗi câu (chia đều) của một phần — giá trị gợi ý khi chưa đặt riêng. */
export function autoCauPoints(partMax: number, count: number): number {
  return count > 0 ? partMax / count : 0;
}
