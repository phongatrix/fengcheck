/**
 * Suy ngược MÃ ĐỀ từ lưới đáp án khi ô mã đề không đọc được (ảnh mờ/nghiêng)
 * hoặc đọc ra mã không có trong đáp án chuẩn (đọc nhầm 1 chữ số).
 *
 * Ý tưởng: so từng mã đề trong đáp án chuẩn với bài đã đọc theo đơn vị CÂU
 * (PHẦN I: số câu; PHẦN II: số câu × ý; PHẦN III: số câu × chữ số) — không
 * phụ thuộc độ dài vector phẳng nên quy đổi được giữa các mẫu giấy. Mã đề có
 * tỉ lệ khớp cao nhất vượt ngưỡng (mặc định 80%) thì nhận: học sinh làm đúng
 * gần hết bài theo mã đó — khớp MÃ ĐỀ dù ô mã đề không đọc được.
 *
 * Chỉ so các ô đáp án CHUẨN CÓ ĐÁP ÁN (>= 0). Ô đọc của phiếu: -1 trống,
 * -2 tô đè → tính là KHÔNG khớp (học sinh không trả lời đúng).
 */

import type { FormKind, SheetLayout } from "./types";
import { sectionsFromAnswers, sectionsFromLayout } from "./key-sections";

export interface KeyLike {
  code: string;
  answers: number[];
}

export interface CodeGuess {
  code: string;
  /** hit / total (chỉ tính ô đáp án chuẩn có đáp án). */
  ratio: number;
  hit: number;
  total: number;
  /** Tỉ lệ của mã xếp thứ hai — để cảnh báo khi hai mã gần nhau. */
  secondRatio: number;
}

/**
 * Số ô tối thiểu để tin một lần suy ngược. 10 quá thấp: đáp án chỉ khai báo
 * 10 ô (toàn Đ/S nhị phân) có thể đạt 8/10 với mã SAI (~5% ngẫu nhiên).
 * Đo đáp án thật dùng trong dự án: k11dapan (mẫu Mới 2025) = 28 ô,
 * k12dapan (Giấy 12) = 40 ô → chọn 20: đủ thấp cho đề nhỏ, đủ cao để loại
 * key khuyết một nửa.
 */
export const MIN_INFER_CELLS = 20;

/**
 * @param readAnswers  vector đáp án đọc được từ phiếu (đúng layout đã đọc)
 * @param readLayout   layout của phiếu vừa đọc
 * @param keys         đáp án chuẩn của bài thi
 * @param form         form đã nhập đáp án (để tách phần)
 * @param ansNumber    số ô đáp án của form khi nhập
 * @param minRatio     ngưỡng chấp nhận (mặc định 0.85 — "suy luận ngược mã đề
 *                     khi số lượng câu khớp >85%", yêu cầu 2026-11-16)
 */
export function inferCodeFromAnswers(
  readAnswers: number[],
  readLayout: SheetLayout,
  keys: KeyLike[],
  form: FormKind,
  ansNumber: number,
  minRatio = 0.85,
): CodeGuess | null {
  if (!keys.length || !readAnswers.length) return null;
  // Bài ĐỌC từ phiếu: không chạy chuẩn hoá encoding cũ (xem sectionsFromLayout).
  const read = sectionsFromLayout(readAnswers, readLayout, { normalize: false });

  /**
   * MẪU SỐ CHUNG cho mọi mã: số ô mà CẢ bản đọc và đáp án cùng xác định được
   * (không phụ thuộc từng key). Trước đây mỗi mã chia cho số ô của chính nó →
   * mã khai báo ít ô (10/10) thắng mã thật (50/60) dù bằng chứng ít hơn.
   */
  const commonCells = (key: ReturnType<typeof sectionsFromAnswers>): number => {
    let n = 0;
    for (const [k2, kv] of Object.entries(key.p1)) if (kv >= 0 && read.p1[Number(k2)] !== undefined) n++;
    for (const [k2, kv] of Object.entries(key.p2)) if (kv >= 0 && read.p2[k2] !== undefined) n++;
    for (const [k2, ds] of Object.entries(key.p3)) {
      const rd = read.p3[Number(k2)];
      ds.forEach((kv, idx) => {
        if (kv >= 0 && rd?.[idx] !== undefined) n++;
      });
    }
    return n;
  };
  const sectionsOf = keys.map((k) => ({ code: k.code, sec: sectionsFromAnswers(k.answers, form, ansNumber) }));
  /**
   * Mẫu số dùng chung = số ô LỚN NHẤT trong các mã. Dùng trung vị thì với 2 mã
   * (1 đầy đủ + 1 khuyết) mẫu số rơi xuống ngưỡng nhỏ và key khuyết vẫn có thể
   * thắng nhờ ít ô hơn. Lớn nhất = "đề này có bao nhiêu ô", key khuyết bị phạt
   * đúng mức.
   */
  const denominators = sectionsOf.map((x) => commonCells(x.sec)).filter((n) => n > 0);
  const denom = denominators.length ? Math.max(...denominators) : 0;
  if (denom < MIN_INFER_CELLS) return null;

  const guesses: CodeGuess[] = [];
  for (const { code, sec } of sectionsOf) {
    let hit = 0;
    const cmp = (rv: number | undefined, kv: number | undefined) => {
      if (kv === undefined || kv < 0) return;
      if (rv === undefined) return;
      if (rv === kv) hit++;
    };
    for (const [n, kv] of Object.entries(sec.p1)) cmp(read.p1[Number(n)], kv);
    for (const [nk, kv] of Object.entries(sec.p2)) cmp(read.p2[nk], kv);
    for (const [n, digits] of Object.entries(sec.p3)) {
      const rd = read.p3[Number(n)];
      digits.forEach((kv, idx) => cmp(rd?.[idx], kv));
    }
    const ratio = hit / denom;
    if (ratio > minRatio) guesses.push({ code, ratio, hit, total: denom, secondRatio: 0 });
  }
  if (!guesses.length) return null;
  guesses.sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  const best = guesses[0];
  best.secondRatio = guesses[1]?.ratio ?? 0;
  /**
   * Cổng PHÂN BIỆT: hai mã đề có đáp án gần như trùng nhau thì bài khớp cả
   * hai — không thể biết thí sinh tô mã nào. Đo đáp án thật (k11dapan /
   * k12dapan) các mã khác nhau 32–60% câu, nên mã đúng thường bỏ xa mã nhì.
   * Khi mã nhì kém mã đầu <15 điểm phần trăm → trả null (thà không suy ngược
   * còn hơn gán sai mã, vì gán sai làm điểm sai hoàn toàn). Đo trên đáp án
   * thật: mã đúng thường hơn mã nhì ≥25 điểm khi bài làm khá.
   */
  if (best.secondRatio > 0 && best.ratio - best.secondRatio < 0.15) return null;
  return best;
}
