/**
 * Bubble / digit reading, ported from the Android detector's two strategies:
 *   j() → contour-based circle detection with pixel density > 0.3
 *   l() → black-pixel counting relative to the mean of the row
 * The result must be exactly one filled bubble, otherwise -1 (blank) / -2 (multi).
 */

import type { GrayMat, Pt, ReadQuestion, SheetLayout } from "./types";
import { adaptiveThresholdInv, countNonZero, gaussianBlur3, meanRect, medianFilter3 } from "./matrix";
import { connectedComponents } from "./markers";

/** Threshold on mean darkness (fraction of dark pixels) to call a bubble filled. */
export const FILL_THRESHOLD = 0.3;

/** Strategy 1: darkness ratio per bubble inside a scan-line band. */
export function readBubbleRowScores(ink: GrayMat, boxes: { x: number; y: number; w: number; h: number }[]): number[] {
  return boxes.map((b) => {
    const area = Math.max(1, b.w * b.h);
    const dark = countNonZero(ink, b);
    return Math.min(1, dark / area);
  });
}

/**
 * Strategy 2 (the original l(), adapted to interior sampling): mean-relative.
 * A bubble counts as filled when its dark ratio is clearly above the row
 * average — a lone pencil fill towers over empty interiors, while a blank row
 * stays flat and a double fill shows two peaks.
 */
export function readBubbleRowMean(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  return scores.map((v) => (v - mean > 0.12 ? 1 : 0));
}

export interface RowRead {
  /** Chosen option or -1 / -2. */
  answer: number;
  scores: number[];
  /** True if the two strategies disagree (original -4). */
  conflict: boolean;
}

/**
 * Decide which bubble is filled using the primary threshold strategy.
 * On real photos sensor noise lifts empty-bubble baselines past the fixed
 * threshold — when several bubbles pass it, accept the strongest as the single
 * answer only if it clearly dominates the runner-up.
 */
export function decideRow(scores: number[]): RowRead {
  let count = 0;
  let pick = -1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > FILL_THRESHOLD) {
      count++;
      pick = i;
    }
  }
  if (count === 0) return { answer: -1, scores, conflict: false };
  if (count === 1) {
    // Một ô vượt ngưỡng tuyệt đối vẫn có thể là NHIỄU: khi cả hàng bị đẩy nền
    // lên (lưới in lệch, vành in lọt vào hộp mẫu) thì ô "đậm nhất" chỉ hơn các
    // ô còn lại chút ít. Đòi thêm bằng chứng — hoặc mực đủ đậm, hoặc bỏ xa ô
    // thứ hai — để không biến ô trống thành đáp án.
    let second = 0;
    for (let i = 0; i < scores.length; i++) if (i !== pick && scores[i] > second) second = scores[i];
    if (scores[pick] >= 0.45 || scores[pick] >= second * 1.6) return { answer: pick, scores, conflict: false };
    return { answer: -1, scores, conflict: false };
  }
  const sorted = [...scores].sort((a, b) => b - a);
  if (sorted[0] >= 0.6 && sorted[0] >= sorted[1] * 1.7) {
    return { answer: scores.indexOf(sorted[0]), scores, conflict: false };
  }
  return { answer: -2, scores, conflict: false };
}

/** Combined read: primary threshold + mean-relative cross-check (original h()). */
export function decideRowDual(scores: number[]): RowRead {
  const primary = decideRow(scores);
  const secondary = readBubbleRowMean(scores);
  const secCount = secondary.reduce((s, v) => s + v, 0);
  const secPick = secondary.indexOf(1);

  if (primary.answer === -2 || primary.answer === -1) {
    // A blank row is consistent when the mean-relative strategy also sees none.
    if (primary.answer === -1 && secCount === 0) return primary;
    if (primary.answer === -2 && secCount >= 1) return primary;
    return { ...primary, conflict: true };
  }
  if (secCount === 0) return { ...primary, conflict: true };
  if (secPick !== primary.answer) return { ...primary, conflict: true };
  return primary;
}

/**
 * Read one digit column (10 bubbles) → digit 0..9 or -1.
 * Decision cascade: single-fill threshold, then a clear-peak rule (one bubble
 * unmistakably darker than the rest — robust on printed cell borders), then
 * the original mean-relative strategy.
 */
export function readDigitColumn(
  ink: GrayMat,
  boxes: { x: number; y: number; w: number; h: number }[],
): number {
  return decideDigitColumn(readBubbleRowScores(ink, boxes));
}

/** Quyết định chữ số từ 10 điểm mực (tách riêng để tái dùng sau hiệu chỉnh lưới). */
export function decideDigitColumn(scores: number[]): number {
  const primary = decideRow(scores);
  if (primary.answer >= 0) return primary.answer;
  let maxI = -1;
  let maxV = 0;
  let second = 0;
  let sum = 0;
  scores.forEach((v, i) => {
    sum += v;
    if (v > maxV) {
      second = maxV;
      maxV = v;
      maxI = i;
    } else if (v > second) {
      second = v;
    }
  });
  const mean = sum / scores.length;
  let varSum = 0;
  for (const v of scores) varSum += (v - mean) * (v - mean);
  const sigma = Math.sqrt(varSum / scores.length);
  // Peak rule: one bubble clearly above both the absolute floor and the row's
  // own noise level (z-score) — robust on printed cell borders and mottle.
  if (maxI >= 0 && maxV >= 0.65 && maxV >= second * 1.2 && maxV - mean >= 1.8 * sigma) {
    return maxI;
  }
  // Fall back to the mean-relative strategy for faint marks.
  const sec = readBubbleRowMean(scores);
  const count = sec.reduce((s, v) => s + v, 0);
  if (count === 1) return sec.indexOf(1);
  return -1;
}

/** Average ink level of the sheet background, used to normalise thresholds. */
export function backgroundLevel(gray: GrayMat): number {
  return meanRect(gray, { x: 0, y: 0, w: gray.width, h: gray.height });
}

/** Mật độ mực trong VÀNH KHUYÊN [rIn,rOut] quanh (cx,cy) — đo "vành in nằm đúng tâm". */
function annulusDensity(ink: GrayMat, cx: number, cy: number, rIn: number, rOut: number): number {
  const x0 = Math.max(0, Math.round(cx - rOut));
  const x1 = Math.min(ink.width, Math.round(cx + rOut));
  const y0 = Math.max(0, Math.round(cy - rOut));
  const y1 = Math.min(ink.height, Math.round(cy + rOut));
  let dark = 0;
  let area = 0;
  const rIn2 = rIn * rIn;
  const rOut2 = rOut * rOut;
  for (let y = y0; y < y1; y++) {
    const base = y * ink.width;
    const dy = y - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 < rIn2 || d2 > rOut2) continue;
      area++;
      if (ink.data[base + x] !== 0) dark++;
    }
  }
  return area ? dark / area : 0;
}

/** Mật độ mực trong ĐĨA bán kính `rr` quanh (cx,cy) — đo "lõi ô có mực". */
function discDensity(ink: GrayMat, cx: number, cy: number, rr: number): number {
  const x0 = Math.max(0, Math.round(cx - rr));
  const x1 = Math.min(ink.width, Math.round(cx + rr));
  const y0 = Math.max(0, Math.round(cy - rr));
  const y1 = Math.min(ink.height, Math.round(cy + rr));
  let dark = 0;
  let area = 0;
  const r2 = rr * rr;
  for (let y = y0; y < y1; y++) {
    const base = y * ink.width;
    const dy = y - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      area++;
      if (ink.data[base + x] !== 0) dark++;
    }
  }
  return area ? dark / area : 0;
}

/**
 * Độ lệch của LƯỚI Ô IN so với lưới toạ độ chuẩn, ước lượng cho TRỌN MỘT HÀNG.
 *
 * Ảnh chụp / bản in không khớp tuyệt đối với toạ độ tách từ PDF: cả hàng ô in
 * bị dịch 0.5–1.0 bán kính. Khi đó hộp mẫu đặt ở toạ độ chuẩn rơi đúng vào
 * VÀNH của ô — mọi ô trong hàng đều "có mực" nên hàng trống bị đọc thành tô đè,
 * còn ô tô thật chỉ được tính một phần (phần đen lọt vào hộp).
 *
 * Cách đo: trượt cả hàng trong ±1 bán kính và chọn vị trí có mật độ mực trên
 * VÀNH KHUYÊN cao nhất — vành in của cả 4 ô cùng dịch nên cộng dồn cho một đỉnh
 * rõ, trong khi mực của hàng bên cạnh thì không cộng hưởng. Chỉ nhận khi vị trí
 * mới thực sự tốt hơn vị trí chuẩn, nếu không giữ (0,0) để lưới đã khớp sẵn
 * không bị "hiệu chỉnh" lệch đi.
 */
export function rowGridOffset(
  ink: GrayMat,
  bubbles: { x: number; y: number; r: number }[],
  /** Bán kính dò, theo bán kính ô (1.0 = đúng một ô). */
  searchRadius = 1.0,
): { dx: number; dy: number } {
  const zero = { dx: 0, dy: 0 };
  const first = bubbles[0];
  if (!first || bubbles.length < 2) return zero;
  const sx = ink.width;
  const sy = ink.height;
  const rPx = first.r * Math.min(sx, sy);
  const rad = Math.max(2, Math.round(searchRadius * rPx));
  const coarseStep = Math.max(1, Math.round(0.3 * rPx));

  const score = (dx: number, dy: number): number => {
    let sum = 0;
    for (const b of bubbles) sum += annulusDensity(ink, b.x * sx + dx, b.y * sy + dy, rPx * 0.78, rPx * 1.22);
    return sum / bubbles.length;
  };

  const atZero = score(0, 0);
  let best = { dx: 0, dy: 0, v: atZero };
  for (let dy = -rad; dy <= rad; dy += coarseStep) {
    for (let dx = -rad; dx <= rad; dx += coarseStep) {
      if (dx === 0 && dy === 0) continue;
      if (dx * dx + dy * dy > rad * rad) continue;
      const v = score(dx, dy);
      if (v > best.v) best = { dx, dy, v };
    }
  }
  // Tinh chỉnh quanh nghiệm thô với bước 1px (chỉ khi thô đã tốt hơn vị trí
  // chuẩn — không tốn thêm khi hàng không lệch).
  if (best.v > atZero) {
    const c = best;
    const fine = coarseStep;
    for (let dy = c.dy - fine; dy <= c.dy + fine; dy++) {
      for (let dx = c.dx - fine; dx <= c.dx + fine; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const v = score(dx, dy);
        if (v > best.v) best = { dx, dy, v };
      }
    }
  }

  // Cổng nhận: phải tìm thấy vành in rõ ràng VÀ tốt hơn hẳn vị trí chuẩn.
  // Không đạt thì giữ nguyên — lưới đã khớp (hoặc ảnh quá mờ) không nên bị dịch.
  if (best.v < 0.4) return zero;
  if (best.v - atZero < 0.05) return zero;
  return { dx: best.dx, dy: best.dy };
}

/** Hộp mẫu cho một ô tròn (tâm chuẩn hoá → pixel, cạnh = 2·0.6·r). */
function bubbleBox(
  b: { x: number; y: number; r: number },
  w: number,
  h: number,
  dx = 0,
  dy = 0,
): { x: number; y: number; w: number; h: number } {
  const rr = Math.max(2, b.r * Math.min(w, h) * 0.6);
  return {
    x: Math.round(b.x * w + dx - rr),
    y: Math.round(b.y * h + dy - rr),
    w: Math.max(2, Math.round(2 * rr)),
    h: Math.max(2, Math.round(2 * rr)),
  };
}

/**
 * Hiệu chỉnh lưới cho từng cột ô chữ số (SBD / Mã đề / PHẦN III).
 *
 * Ảnh chụp thật bị cong giấy + méo ống kính: lưới lệch tới 6–8pt so với toạ độ
 * chuẩn, đủ để hộp mẫu 2.3pt rơi vào vạch kẻ ô và mọi dòng đều "có mực".
 *
 * Hai bước: (1) offset chung cho cả khối, tìm trên vùng rộng; (2) tinh chỉnh
 * từng cột trong ±2pt quanh offset chung — cong giấy làm mỗi cột lệch một ít.
 * Chỉ nhận offset tạo ra MỘT ô tô rõ ràng; không có thì trả (0,0) để phiếu
 * trắng / ô trống không bị "hiệu chỉnh" vào vạch kẻ sinh chữ số ma.
 */
export function refineDigitColumns(
  ink: GrayMat,
  columns: { bubbles: { x: number; y: number; r: number }[] }[],
  boxFor?: (b: { x: number; y: number; r: number }, dx: number, dy: number) => { x: number; y: number; w: number; h: number },
  /** Bán kính dò, tính theo bán kính ô (1.0 = đúng một ô). */
  searchRadius = 2.2,
): { dx: number; dy: number }[] {
  const minSide = Math.min(ink.width, ink.height);
  const zero = { dx: 0, dy: 0 };
  // Khoảng dò neo theo BÁN KÍNH Ô (không theo pt) để đúng cho mọi layout
  // (QM_A4 595pt rộng, MOI 406px rộng, custom…).
  const first = columns[0]?.bubbles[0];
  if (!first) return columns.map(() => zero);
  const rPx = first.r * minSide;
  const coarse = Math.max(2, Math.round(searchRadius * rPx));
  const coarseStep = Math.max(1, Math.round(0.3 * rPx));
  const fine = Math.max(2, Math.round(0.6 * rPx));
  const fineStep = Math.max(1, Math.round(0.2 * rPx));

  const box = boxFor ?? ((b: { x: number; y: number; r: number }, dx: number, dy: number) => bubbleBox(b, ink.width, ink.height, dx, dy));

  /** Điểm của một cột tại offset: 1 khi có ô tô rõ ràng, 0 khi không. */
  const columnScore = (
    bubbles: { x: number; y: number; r: number }[],
    dx: number,
    dy: number,
  ): { clear: number; strength: number } => {
    const scores = readBubbleRowScores(ink, bubbles.map((b) => box(b, dx, dy)));
    if (scores.length < 2) return { clear: 0, strength: 0 };
    const sorted = [...scores].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    const second = sorted[sorted.length - 2];
    const median = sorted[Math.floor(sorted.length / 2)];
    const clear = max >= 0.62 && max >= second * 1.35 ? 1 : 0;
    return { clear, strength: max - median };
  };

  /**
   * Điểm cho cả khối: ưu tiên offset làm NHIỀU cột đọc rõ nhất (mục tiêu thật
   * của bài toán), hoà thì lấy tổng độ tương phản. Nếu chỉ chấm theo "một ô đậm
   * nhất" thì offset sẽ trượt về phía một ô tô đậm và bỏ rơi các cột khác.
   */
  const blockScore = (dx: number, dy: number): { clear: number; strength: number } => {
    let clear = 0;
    let strength = 0;
    for (const col of columns) {
      const s = columnScore(col.bubbles, dx, dy);
      clear += s.clear;
      strength += s.strength;
    }
    return { clear, strength };
  };

  const search = (
    range: number,
    step: number,
    scoreFn: (dx: number, dy: number) => { clear: number; strength: number },
    cx = 0,
    cy = 0,
  ): { dx: number; dy: number; clear: number; strength: number } => {
    let best = { dx: cx, dy: cy, clear: 0, strength: -Infinity };
    for (let dy = cy - range; dy <= cy + range; dy += step) {
      for (let dx = cx - range; dx <= cx + range; dx += step) {
        const s = scoreFn(dx, dy);
        if (
          s.clear > best.clear ||
          (s.clear === best.clear && s.strength > best.strength)
        ) {
          best = { dx, dy, ...s };
        }
      }
    }
    return best;
  };

  // (1) offset chung cho khối, vùng rộng. Chỉ dùng khi nó thực sự làm nhiều
  // cột đọc rõ hơn vị trí chuẩn — lưới đã khớp sẵn thì giữ nguyên (0,0).
  const atZero = blockScore(0, 0);
  const block = search(coarse, coarseStep, blockScore);
  if (block.clear === 0 || block.clear <= atZero.clear) return columns.map(() => zero);

  // (2) Tinh chỉnh chung cho cả khối quanh offset vừa tìm (giấy cong đều nên
  // các cột lệch gần như nhau). KHÔNG cho từng cột tự đi tìm offset riêng: một
  // cột trống có thể "khớp" vào vạch kẻ ở chỗ khác và bịa ra chữ số.
  const fineBest = search(fine, fineStep, blockScore, block.dx, block.dy);
  const final = fineBest.clear >= block.clear ? fineBest : block;
  return columns.map(() => ({ dx: final.dx, dy: final.dy }));
}

/** Đọc một khối chữ số đã hiệu chỉnh lưới → chữ số từng cột (0..9, -1 trống). */
/**
 * Offset hiệu chỉnh lưới từng cột chữ số — tính một lần cho cả khối, tái dùng
 * cho các ô dấu (− ,) nằm trên cùng lưới với cột tương ứng.
 */
export function digitColumnOffsets(
  ink: GrayMat,
  columns: { bubbles: { x: number; y: number; r: number }[] }[],
  boxFor?: (b: { x: number; y: number; r: number }, dx: number, dy: number) => { x: number; y: number; w: number; h: number },
  allowRefine = true,
  /** Bán kính dò refine (theo bán kính ô) — mặc định 2.2. */
  searchRadius = 2.2,
): { dx: number; dy: number }[] {
  return allowRefine
    ? refineDigitColumns(ink, columns, boxFor, searchRadius)
    : columns.map(() => ({ dx: 0, dy: 0 }));
}

export function readDigitBlock(
  ink: GrayMat,
  columns: { bubbles: { x: number; y: number; r: number }[] }[],
  boxFor?: (b: { x: number; y: number; r: number }, dx: number, dy: number) => { x: number; y: number; w: number; h: number },
  /** false = lưới đã được hiệu chuẩn sẵn, không cần (và không nên) dò offset. */
  allowRefine = true,
  /** Offset đã tính (từ digitColumnOffsets) — bỏ qua bước dò lại. */
  offsets?: { dx: number; dy: number }[],
): number[] {
  const offs = offsets ?? digitColumnOffsets(ink, columns, boxFor, allowRefine);
  const box = boxFor ?? ((b, dx, dy) => bubbleBox(b, ink.width, ink.height, dx, dy));
  return columns.map((col, i) => {
    const { dx, dy } = offs[i];
    const scores = readBubbleRowScores(ink, col.bubbles.map((b) => box(b, dx, dy)));
    // Cổng tuyệt đối: ô chữ số tô thật cho ≥0.8 mực; ảnh mờ/nhiễu chỉ 0.1–0.3.
    // Dưới ngưỡng thì trả "trống" — thà mất số báo danh còn hơn bịa số sai.
    const max = scores.reduce((a, b) => (b > a ? b : a), 0);
    if (max < 0.5) return -1;
    return decideDigitColumn(scores);
  });
}

/**
 * Đọc 3 ô dấu của một câu PHẦN III (dấu − và 2 ô dấu thập phân), dùng đúng
 * offset lưới của cột chữ số tương ứng (ô − theo cột 1, 2 ô dấu thập phân
 * theo cột 2/3). Giống cổng ô chữ số: mực < 0.5 = không tô; 2 ô dấu thập phân
 * cùng vượt ngưỡng thì coi như không rõ (trả -1, đừng đoán).
 */
export function readSignRow(
  ink: GrayMat,
  signs: { neg: { x: number; y: number; r: number }; comma1: { x: number; y: number; r: number }; comma2: { x: number; y: number; r: number } },
  digitOffsets: { dx: number; dy: number }[],
  boxFor?: (b: { x: number; y: number; r: number }, dx: number, dy: number) => { x: number; y: number; w: number; h: number },
): { neg: boolean; comma: number } {
  const box = boxFor ?? ((b, dx, dy) => bubbleBox(b, ink.width, ink.height, dx, dy));
  const link = [0, 1, 2]; // ô dấu ghép offset với cột chữ số cùng x
  const [negB, c1, c2] = [signs.neg, signs.comma1, signs.comma2];
  const negScore = readBubbleRowScores(ink, [box(negB, digitOffsets[link[0]].dx, digitOffsets[link[0]].dy)])[0] ?? 0;
  const commaScores = readBubbleRowScores(ink, [
    box(c1, digitOffsets[link[1]].dx, digitOffsets[link[1]].dy),
    box(c2, digitOffsets[link[2]].dx, digitOffsets[link[2]].dy),
  ]);
  const neg = negScore >= 0.5;
  const c1v = commaScores[0] ?? 0;
  const c2v = commaScores[1] ?? 0;
  let comma = -1;
  if (c1v >= 0.5 && c2v < 0.5) comma = 0;
  else if (c2v >= 0.5 && c1v < 0.5) comma = 1;
  return { neg, comma };
}

/**
 * Build the inverse binary ink map used for bubble counting.
 * A Gaussian pre-pass kills sensor/JPEG noise so the adaptive threshold only
 * fires on real strokes and fills (phone photos are noisy even after warp).
 * Self-tuning: on low-contrast sources (photo-reconstructed templates, dim
 * scans) the first pass marks most of the paper as ink — raise C until the
 * ink density reaches a sane level.
 */
/**
 * Bộ nhớ đệm inkMap theo ẢNH (WeakMap theo object GrayMat): cùng một ảnh warp
 * được inkMap nhiều lần trong luồng chấm — đọc ô (readCanonicalSheet), xếp hạng
 * probe (readQuality/readRing), lớp hiệu chỉnh lưới (inkForFit, gridInk) — mỗi
 * lần tốn ~0.3s ở không gian 1000×1415. Kết quả gắn với object ảnh: ảnh bị GC
 * thì đệm tự giải phóng, không rò rỉ.
 */
const inkMapCache = new WeakMap<GrayMat, GrayMat>();

export function inkMap(gray: GrayMat): GrayMat {
  const hit = inkMapCache.get(gray);
  if (hit) return hit;
  const blurred = gaussianBlur3(medianFilter3(gray));
  let c = 14;
  let ink: GrayMat | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    ink = adaptiveThresholdInv(blurred, 41, c);
    let n = 0;
    for (let i = 0; i < ink.data.length; i++) n += ink.data[i] !== 0 ? 1 : 0;
    if (n / ink.data.length <= 0.22) break;
    c += 6;
    ink = null;
  }
  const result = ink ?? adaptiveThresholdInv(blurred, 41, c);
  inkMapCache.set(gray, result);
  return result;
}

export interface SheetReadOptions {
  /** Include the 6-digit student code block. */
  readStudentCode?: boolean;
  /** Include the 3-digit exam code block. */
  readExamCode?: boolean;
  /** Scale from canonical units to pixels. */
  scaleX: number;
  scaleY: number;
  /** Strict mode flags conflicts as read errors. */
  strict?: boolean;
}

export interface SheetReadInternal {
  questions: {
    index: number;
    answer: number;
    scores: number[];
    unsure: boolean;
    /** Tâm ô đã dùng khi đọc (canonical px) — vẽ chú thích đúng chỗ ô in. */
    center?: Pt;
  }[];
  /** PHẦN III: per numeric câu, per digit column — value 0..9 or -1 blank. */
  part3: number[][];
  /** PHẦN III ô dấu (− / dấu thập phân), song song `part3` — null khi câu không có ô dấu. */
  part3Signs?: ({ neg: boolean; comma: number } | null)[];
  examCode: string | null;
  studentCode: string | null;
  readError: boolean;
}

/**
 * Refit lưới mã đề / SBD theo các ô VÀNH RỖNG (ring-only) trên ảnh warp.
 *
 * Ảnh chụp nghiêng/giấy cong mà khung marker có góc DỰ ĐOÁN (quadApprox) thì
 * warp còn xiên: lưới mã đề trôi 10-30px khỏi toạ độ chuẩn. Dò các blob vành
 * rỗng (loại ô tô ĐẶC và nhãn số), ước offset toàn cục bằng soft-score
 * (Σ max(0, snap − dist)) — phân biệt được offset thật khỏi lệch < 1 pitch —
 * rồi gán từng ô, trung bình nhiều blob/ô, điền ô thiếu bằng median cột.
 *
 * Cổng an toàn: ≥ 60% ô khớp, mỗi cột ≥ 7/10 ô, pitch sau sửa đều (±45%),
 * và mật độ vành trung bình sau sửa phải tăng. Thất bại → null (giữ chuẩn).
 */
export function refineGridBubbles(
  ink: GrayMat,
  columns: { bubbles: { x: number; y: number; r: number }[] }[],
): { bubbles: { x: number; y: number; r: number }[] }[] | null {
  const nCols = columns.length;
  const nRows = columns[0]?.bubbles.length ?? 0;
  if (nCols < 2 || nRows < 6) return null;
  const sx = ink.width;
  const sy = ink.height;
  const minSide = Math.min(sx, sy);
  const px = columns.map((c) => c.bubbles.map((b) => ({ x: b.x * sx, y: b.y * sy, r: b.r * minSide })));
  const rPx = px[0][0].r;
  const pitchY = medianOf(px[0].slice(1).map((b, i) => b.y - px[0][i].y));
  const pitchX = medianOf(px.slice(1).map((c, i) => c[0].x - px[i][0].x));
  if (!(pitchY > 4) || !(pitchX > 4)) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const col of px) for (const b of col) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x); y1 = Math.max(y1, b.y);
  }
  const pad = Math.max(26, 1.8 * Math.max(pitchX, pitchY));
  const rx0 = Math.max(0, Math.round(x0 - pad));
  const ry0 = Math.max(0, Math.round(y0 - pad));
  const rx1 = Math.min(sx, Math.round(x1 + pad));
  const ry1 = Math.min(sy, Math.round(y1 + pad));
  const win: GrayMat = { width: rx1 - rx0, height: ry1 - ry0, data: new Uint8ClampedArray((rx1 - rx0) * (ry1 - ry0)) };
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      win.data[(y - ry0) * win.width + (x - rx0)] = ink.data[y * sx + x] !== 0 ? 255 : 0;
    }
  }
  const blobs = connectedComponents(win, 18);
  const D = 2 * rPx + 3;
  // Chỉ nhận VÀNH RỖNG: fill vừa phải, không đặc (ô tô đặc = fill cao + lõi đen).
  // Nhãn số in ngoài lưới bị loại bằng cửa sổ x (ngoài 0.55 pitch trái cột 1).
  const cands = blobs
    .map((b) => {
      const d = Math.max(b.w, b.h);
      const cx = b.cx + rx0;
      const cy = b.cy + ry0;
      // tỉ lệ mực trong lõi (1/3 kích thước): ô tô đặc ~1.0, vành rỗng ~0-0.4
      const q = Math.max(1, Math.round(Math.min(b.w, b.h) / 6));
      let core = 0;
      let coreTot = 0;
      for (let yy = Math.round(b.cy) - q; yy <= Math.round(b.cy) + q; yy++) {
        for (let xx = Math.round(b.cx) - q; xx <= Math.round(b.cx) + q; xx++) {
          if (xx < 0 || yy < 0 || xx >= win.width || yy >= win.height) continue;
          coreTot++;
          if (win.data[yy * win.width + xx] !== 0) core++;
        }
      }
      const coreRatio = coreTot ? core / coreTot : 1;
      return { cx, cy, d, fill: b.fill, coreRatio };
    })
    .filter((c) => {
      if (c.d < 0.55 * D || c.d > 1.7 * D) return false;
      if (Math.max(c.fill, c.coreRatio) > 0.62) return false; // ô tô đặc
      if (c.cx < x0 - 0.55 * pitchX || c.cx > x1 + 0.55 * pitchX) return false;
      if (c.cy < y0 - 0.6 * pitchY || c.cy > y1 + 0.6 * pitchY) return false;
      return true;
    });
  if (cands.length < 0.5 * nCols * nRows) {
    if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: ít candidate ${cands.length}/${nCols * nRows}`);
    return null;
  }

  const snap = Math.max(6, 0.7 * Math.max(pitchX, pitchY));
  // Coarse offset (chiều layout → candidate): dịch ô chuẩn (dx,dy), soft-score
  // (gần hơn = điểm cao hơn) — phân biệt offset thật khỏi lệch < 1 pitch.
  const soft = (dx: number, dy: number) => {
    let s = 0;
    for (const c of cands) {
      const ci = Math.round((c.cx - dx - px[0][0].x) / pitchX);
      const ri = Math.round((c.cy - dy - px[0][0].y) / pitchY);
      if (ci < 0 || ci >= nCols || ri < 0 || ri >= nRows) continue;
      const d = Math.hypot(px[ci][ri].x + dx - c.cx, px[ci][ri].y + dy - c.cy);
      if (d <= snap) s += snap - d;
    }
    return s;
  };
  const range = Math.round(1.6 * Math.max(pitchX, pitchY));
  let gdx = 0;
  let gdy = 0;
  let gBest = -1;
  for (let dy = -range; dy <= range; dy += 2) {
    for (let dx = -range; dx <= range; dx += 2) {
      const s = soft(dx, dy);
      if (s > gBest || (s === gBest && Math.hypot(dx, dy) < Math.hypot(gdx, gdy))) {
        gBest = s; gdx = dx; gdy = dy;
      }
    }
  }
  if (gBest <= 0) {
    if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: gBest=${gBest}`);
    return null;
  }

  // Gán blob về ô: ô chuẩn DỊCH (gdx,gdy) rồi lấy blob GẦN NHẤT; vị trí sửa
  // = tâm blob thật (đưa ô chuẩn về chỗ in thực), không phải phép dịch ngược.
  const cell = new Map<string, { x: number; y: number; n: number }>();
  for (const c of cands) {
    let best: { ci: number; ri: number; d: number } | null = null;
    for (let ci = 0; ci < nCols; ci++) {
      for (let ri = 0; ri < nRows; ri++) {
        const d = Math.hypot(px[ci][ri].x + gdx - c.cx, px[ci][ri].y + gdy - c.cy);
        if (!best || d < best.d) best = { ci, ri, d };
      }
    }
    if (!best || best.d > snap) continue;
    const key = `${best.ci}:${best.ri}`;
    const cur = cell.get(key);
    if (cur) { cur.x += c.cx; cur.y += c.cy; cur.n++; }
    else cell.set(key, { x: c.cx, y: c.cy, n: 1 });
  }
  if (cell.size < 0.7 * nCols * nRows) {
    if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: gán ${cell.size}/${nCols * nRows} ô (gdx=${gdx},gdy=${gdy})`);
    return null;
  }

  // Sửa từng cột; ô thiếu nội suy theo hồi quy tuyến (dx,dy) theo hàng —
  // warp xiên làm lệch tăng dần, median phẳng sẽ sai.
  const out = columns.map((c) => ({ bubbles: c.bubbles.map((b) => ({ ...b })) }));
  let okCols = 0;
  for (let ci = 0; ci < nCols; ci++) {
    const dxs: number[] = [];
    const dys: number[] = [];
    const dxsIndex: number[] = [];
    const dysIndex: number[] = [];
    const hits: ({ x: number; y: number } | null)[] = [];
    for (let ri = 0; ri < nRows; ri++) {
      const m = cell.get(`${ci}:${ri}`);
      if (m) {
        const ax = m.x / m.n;
        const ay = m.y / m.n;
        dxs.push(ax - px[ci][ri].x);
        dys.push(ay - px[ci][ri].y);
        dxsIndex.push(ri);
        dysIndex.push(ri);
        hits.push({ x: ax, y: ay });
      } else hits.push(null);
    }
    if (hits.filter(Boolean).length < nRows - 2) {
      if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: cột ${ci} chỉ ${hits.filter(Boolean).length}/${nRows} ô`);
      continue;
    }
    const fit1d = (pts: [number, number][]) => {
      const n = pts.length;
      if (n === 0) return () => 0;
      if (n === 1) return () => pts[0][1];
      let si = 0, sv = 0, sii = 0, siv = 0;
      for (const [i, v] of pts) { si += i; sv += v; sii += i * i; siv += i * v; }
      const den = n * sii - si * si;
      const a = den ? (n * siv - si * sv) / den : 0;
      const b = (sv - a * si) / n;
      return (i: number) => a * i + b;
    };
    const fdy = fit1d(dysIndex.map((i, k) => [i, dys[k]] as [number, number]));
    const fdx = fit1d(dxsIndex.map((i, k) => [i, dxs[k]] as [number, number]));
    let ok = true;
    for (let ri = 0; ri < nRows; ri++) {
      const h = hits[ri];
      const nx = h ? h.x : px[ci][ri].x + fdx(ri);
      const ny = h ? h.y : px[ci][ri].y + fdy(ri);
      if (ri > 0) {
        const gap = ny - out[ci].bubbles[ri - 1].y * sy;
        // Nới cửa pitch: méo phi tuyến + ô nội suy cho gap lệch hợp lệ tới ~1.8 pitch.
        if (gap < 0.4 * pitchY || gap > 1.8 * pitchY) {
          if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: cột ${ci} pitch vỡ tại hàng ${ri} (gap=${gap.toFixed(1)})`);
          ok = false;
          break;
        }
      }
      out[ci].bubbles[ri] = { x: nx / sx, y: ny / sy, r: columns[ci].bubbles[ri].r };
    }
    if (ok) okCols++;
  }
  if (okCols < nCols) {
    if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: chỉ ${okCols}/${nCols} cột đạt`);
    return null;
  }
  // Cổng cuối: mật độ vành trung bình ở vị trí sửa phải tốt hơn vị trí chuẩn
  // (ô sửa đúng chỗ in thì vành khớp tâm; sửa bậy thì vành rơi khỏi hộp).
  let baseAll = 0;
  let newAll = 0;
  for (let ri = 0; ri < nRows; ri++) {
    for (let ci = 0; ci < nCols; ci++) {
      baseAll += ringDensity(ink, px[ci][ri].x, px[ci][ri].y, rPx);
      newAll += ringDensity(ink, out[ci].bubbles[ri].x * sx, out[ci].bubbles[ri].y * sy, rPx);
    }
  }
  baseAll /= nCols * nRows;
  newAll /= nCols * nRows;
  if (newAll < baseAll + 0.02) {
    if (process.env.CHAMBAI_REFIT_DEBUG) console.log(`refit: mật độ vành ${newAll.toFixed(3)} < ${baseAll.toFixed(3)} + 0.02`);
    return null;
  }
  return out;
}

/** Mật độ vành ô in tại (cx,cy) — 8 hướng × 2 bán kính. Bản địa để tránh
 * vòng import reader ↔ grid-fit. */
function ringDensity(
  ink: GrayMat,
  cx: number,
  cy: number,
  rPx: number,
): number {
  let dark = 0;
  let tot = 0;
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    for (const rr of [rPx * 0.9, rPx * 1.1]) {
      const x = Math.round(cx + Math.cos(rad) * rr);
      const y = Math.round(cy + Math.sin(rad) * rr);
      if (x < 0 || y < 0 || x >= ink.width || y >= ink.height) continue;
      tot++;
      if (ink.data[y * ink.width + x] !== 0) dark++;
    }
  }
  return tot ? dark / tot : 0;
}

function medianOf(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Read a canonical (already warped) sheet.
 * Bubble centers are canonical [0,1] coordinates, so multiply by the warp size.
 */
export function readCanonicalSheet(
  canonical: GrayMat,
  layout: SheetLayout,
  opts: {
    readExamCode: boolean;
    readStudentCode: boolean;
    strict?: boolean;
    /** Thu thập cặp lệch lưới (expected → snapped) của bubble có mực để hiệu chỉnh warp. */
    gridPairs?: { ex: number; ey: number; ax: number; ay: number }[];
    /**
     * Lượt PROBE mẫu giấy: bỏ PHẦN III (khối chữ số + ô dấu — 2/3 số ô của
     * phiếu) để probe nhanh ~40%. Chỉ dùng để XẾP HẠNG giữa các mẫu (ring ×
     * decided trên P1+P2 đủ phân biệt), bản đọc chính thức không bao giờ dùng.
     */
    probeSkipP3?: boolean;
  },
): SheetReadInternal {
  const ink = inkMap(canonical);
  const sx = canonical.width;
  const sy = canonical.height;

  /**
   * Snap an expected bubble center to the actual printed ring: residual lens
   * / perspective distortion shifts bubbles by up to ~1 radius on real phone
   * photos, and the ring's ink centroid recovers that locally.
   */
  const snap = (fx: number, fy: number, r: number): Pt => {
    const cx = fx * sx;
    const cy = fy * sy;
    // Keep the window inside the bubble's cell: in dense digit grids the
    // printed cell border would otherwise drag the centroid off-center.
    const rad = Math.max(3, Math.round(r * Math.min(sx, sy) * (layout.snapFactor ?? 1.0)));
    const x0 = Math.max(0, Math.round(cx - rad));
    const y0 = Math.max(0, Math.round(cy - rad));
    const x1 = Math.min(sx, Math.round(cx + rad));
    const y1 = Math.min(sy, Math.round(cy + rad));
    let sumX = 0;
    let sumY = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      const base = y * sx;
      for (let x = x0; x < x1; x++) {
        if (ink.data[base + x] !== 0) {
          sumX += x;
          sumY += y;
          n++;
        }
      }
    }
    if (n < 6) return { x: cx, y: cy };
    const px = sumX / n;
    const py = sumY / n;
    // Reject jumps that clearly left the bubble. Sai lệch hệ thống của cả hàng
    // đã do rowGridOffset lo, nên snap chỉ cần sửa phần dư cục bộ: nhảy xa hơn
    // 0.75 bán kính nghĩa là trọng tâm bám vào cung vành / nét kẻ bên cạnh,
    // không phải ô đã tô.
    const rPx = r * Math.min(sx, sy);
    if (Math.hypot(px - cx, py - cy) > rPx * 0.75) return { x: cx, y: cy };
    // Core gate: LÕI ô phải có mực thì mới coi là "ô đã tô". Vành in mờ / đứt
    // nét kéo trọng tâm về phía cung còn đậm, và nếu snap theo nó thì hộp mẫu
    // rơi lên chính nét vành → ô TRỐNG bị đọc thành "có tô". Ngược lại bút chì
    // tô luôn phủ kín lõi, nên điều kiện này không loại oan ô đã tô.
    const coreRad = Math.max(1.5, rPx * 0.35);
    let coreDark = 0;
    let coreArea = 0;
    for (let y = Math.max(0, Math.round(py - coreRad)); y <= Math.min(sy - 1, Math.round(py + coreRad)); y++) {
      for (let x = Math.max(0, Math.round(px - coreRad)); x <= Math.min(sx - 1, Math.round(px + coreRad)); x++) {
        if ((x - px) ** 2 + (y - py) ** 2 > coreRad * coreRad) continue;
        coreArea++;
        if (ink.data[y * sx + x] !== 0) coreDark++;
      }
    }
    if (coreArea === 0 || coreDark / coreArea < 0.5) return { x: cx, y: cy };
    // Density gate: only snap when a coherent ink blob (a real fill) sits at
    // the centroid — on noisy paper the centroid otherwise drifts onto mottle
    // and inflates every baseline in the row.
    const bx = Math.round(px);
    const by = Math.round(py);
    const half = Math.max(2, Math.round(rPx * 0.6));
    let dark = 0;
    let area = 0;
    for (let y = Math.max(0, by - half); y <= Math.min(sy - 1, by + half); y++) {
      for (let x = Math.max(0, bx - half); x <= Math.min(sx - 1, bx + half); x++) {
        area++;
        if (ink.data[y * sx + x] !== 0) dark++;
      }
    }
    if (area === 0 || dark / area < 0.45) return { x: cx, y: cy };
    return { x: px, y: py };
  };

  /**
   * Hộp mẫu cho một hàng ô, dịch thêm (dx,dy) nếu lưới in lệch khỏi lưới chuẩn.
   * Trả kèm tâm đã dùng để vẽ chú thích đúng chỗ ô in (không phải toạ độ chuẩn).
   */
  const toBoxes = (
    bubbles: { x: number; y: number; r: number }[],
    dx = 0,
    dy = 0,
  ): { boxes: { x: number; y: number; w: number; h: number }[]; centers: Pt[] } => {
    const centers: Pt[] = [];
    const boxes = bubbles.map((b) => {
      // Sample at 60% of the ring radius: inside the printed ring stroke.
      // A pencil fill covers this interior (high ratio); an empty bubble only
      // has its ring outline outside the box (ratio ≈ 0).
      const c = snap((b.x * sx + dx) / sx, (b.y * sy + dy) / sy, b.r);
      centers.push(c);
      const rr = b.r * Math.min(sx, sy) * 0.6;
      return {
        x: Math.round(c.x - rr),
        y: Math.round(c.y - rr),
        w: Math.max(2, Math.round(2 * rr)),
        h: Math.max(2, Math.round(2 * rr)),
      };
    });
    return { boxes, centers };
  };

  let readError = false;
  const questions = layout.questions.map((q) => {
    // Đọc bình thường trước (lưới đã khớp ở đa số phiếu): rẻ và không đổi hành vi.
    const first = toBoxes(q.bubbles);
    let scores = readBubbleRowScores(ink, first.boxes);
    let row = decideRowDual(scores);
    let centers = first.centers;

    /**
     * Cổng LÕI Ô: vết tô thật — kể cả khi chỉ lọt một phần vào ô chuẩn — luôn
     * phủ TÂM ô; vành in mờ/đứt nét và nét kẻ khung thì không. Cổng này chặn
     * trường hợp hộp mẫu/hộp dò rơi lên vành in và biến ô trống thành đáp án.
     */
    const coreOk = (i: number, cx: number, cy: number) => {
      const b = q.bubbles[i];
      const rPx = b.r * Math.min(sx, sy);
      return discDensity(ink, cx, cy, Math.max(1.5, rPx * 0.35)) >= 0.45;
    };

    // Đáp án đọc được từ lưới chuẩn vẫn phải qua cổng lõi ô.
    if (row.answer >= 0) {
      const c = centers[row.answer];
      if (!coreOk(row.answer, c.x, c.y)) row = { ...row, answer: -1 };
    }

    // Không ra đáp án (trống / tô đè / bị cổng lõi loại) → nghi lưới in lệch:
    // dò offset của CẢ HÀNG rồi đọc lại. Nhờ vậy mực lọt một phần vào ô chuẩn
    // vẫn được tính, và hàng trống không bị đọc thành "tô đè" do vành in rơi
    // vào hộp mẫu.
    if (row.answer < 0) {
      const off = rowGridOffset(ink, q.bubbles);
      if (off.dx !== 0 || off.dy !== 0) {
        const shifted = toBoxes(q.bubbles, off.dx, off.dy);
        const scores2 = readBubbleRowScores(ink, shifted.boxes);
        const row2 = decideRowDual(scores2);
        // Chỉ nhận khi đọc được đáp án rõ ràng (một ô) VÀ ô đó có mực ở lõi
        // theo tâm lưới đã dịch, hoặc khi hàng hoá TRỐNG thật (bỏ hẳn "tô đè"
        // giả do vành in).
        let accept = false;
        if (row2.answer >= 0) {
          const b = q.bubbles[row2.answer];
          accept = coreOk(row2.answer, b.x * sx + off.dx, b.y * sy + off.dy);
        } else if (row2.answer === -1 && row.answer === -2) {
          accept = true;
        }
        if (accept) {
          scores = scores2;
          row = row2;
          centers = shifted.centers;
        }
      }
    }

    if (row.conflict && opts.strict) readError = true;
    // Thu thập cặp (vị trí chuẩn → vị trí snap thực) cho các bubble CÓ mực —
    // đầu vào của bước hiệu chỉnh lưới (grid fit) ở pipeline.
    if (opts.gridPairs) {
      q.bubbles.forEach((b, bi) => {
        const c = centers[bi];
        const ex = b.x * sx;
        const ey = b.y * sy;
        if (Math.hypot(c.x - ex, c.y - ey) > 1.5) {
          opts.gridPairs!.push({ ex, ey, ax: c.x, ay: c.y });
        }
      });
    }
    return {
      index: q.index,
      answer: row.answer,
      scores,
      center: centers[row.answer >= 0 ? row.answer : 0],
      unsure: row.answer < 0 || row.conflict,
    };
  });

  // PHẦN III — every digit column of every numeric câu (0..9, -1 blank).
  // Lưới chữ số nhỏ (3.8pt) nên hiệu chỉnh offset từng cột trước khi đọc.
  // Ô chữ số: KHÔNG snap từng ô. Lưới chữ số dày (bước 1.2–2.4 lần bán kính),
  // snap dễ nhảy sang ô bên cạnh; sai lệch toàn khối đã do refineDigitColumns
  // (dx,dy) xử lý, nên chỉ cần cộng offset là đủ. Offset của cột cũng áp cho
  // các Ô DẤU (− ,) cùng lưới ở phía trên.
  const digitBox = (b: { x: number; y: number; r: number }, dx: number, dy: number) =>
    bubbleBox(b, sx, sy, dx, dy);
  // Layout khai báo snapFactor là lưới xấp xỉ (mẫu dựng lại) — không dò offset
  // kẻo "hiệu chỉnh" vào ô khác; mẫu in thật (không snapFactor) mới dò.
  const allowRefine = layout.snapFactor === undefined;
  /**
   * Tương phản xám của một ô so với NỀN cột (trung vị các ô khác cùng cột):
   * nét chì thật tối hơn nền rõ rệt (≥ 30/255); nếp gấp/bóng/đổ bóng trên giấy
   * chỉ tối hơn vài mức — ink map thích nghi vẫn biến chúng thành "mực" và
   * bịa ra ô ma (cả 4 cột cùng đọc một số). Đo trên ảnh XÁM nên không lệ thuộc
   * ngưỡng adaptive.
   */
  const grayMean = (b: { x: number; y: number; r: number }, dx: number, dy: number) => {
    const bx = digitBox(b, dx, dy);
    let s = 0;
    let n = 0;
    for (let y = bx.y; y < bx.y + bx.h; y++) {
      if (y < 0 || y >= sy) continue;
      for (let x = bx.x; x < bx.x + bx.w; x++) {
        if (x < 0 || x >= sx) continue;
        s += canonical.data[y * sx + x];
        n++;
      }
    }
    return n ? s / n : 255;
  };
  const grayContrast = (
    col: { bubbles: { x: number; y: number; r: number }[] },
    row: number,
    dx: number,
    dy: number,
  ) => {
    const cur = grayMean(col.bubbles[row], dx, dy);
    const base = col.bubbles
      .filter((_, k) => k !== row)
      .map((o) => grayMean(o, dx, dy))
      .sort((a, b) => a - b);
    const med = base.length ? base[Math.floor(base.length / 2)] : 255;
    return med - cur;
  };

  // Lượt PROBE mẫu giấy (probeSkipP3): bỏ toàn bộ PHẦN III — khối chữ số + ô
  // dấu chiếm ~2/3 số ô và là phần đắt nhất (đọc từng cột + hiệu chỉnh offset).
  // Probe chỉ cần XẾP HẠNG giữa các mẫu bằng ring × decided trên P1+P2, còn
  // bản đọc chính thức không bao giờ bật cờ này.
  const part3Rows = opts.probeSkipP3
    ? []
    : layout.part3.map((q) => {
    // Bán kính dò refine GIỮ 2.2× (đo được: khối P3 in lệch tới ~2.4×r so với
    // layout; hạ xuống 1.3 làm MẤT chữ số thật — roundtrip render sai 7–10 ô).
    // "Vòng xanh dư" PHẦN III được chặn bằng HÌNH DẠNG mực bên dưới: ô tô thật
    // là đốm gọn ≤2.6×r (đo 14×14px với r = 7.1), nét in thì kéo dài
    // (vòng tròn in 33×33, dây kẻ lưới 33×5).
    const offs = digitColumnOffsets(ink, q.columns, digitBox, allowRefine);
    const digits = readDigitBlock(ink, q.columns, digitBox, allowRefine, offs);
    // Lọc ô ma: ô quyết định phải tối hơn nền cột rõ ràng mới nhận.
    const digitsClean = process.env.CHAMBAI_NO_GUARD === "1"
      ? digits
      : digits.map((d, di) => {
          if (d < 0) return d;
          return grayContrast(q.columns[di], d, offs[di].dx, offs[di].dy) >= 30 ? d : -1;
        });
    // CHẶN Ô MA PHẦN III (yêu cầu 2026-11-17: vòng xanh dư trên ô trống).
    // Ô TÔ THẬT phải đồng thời: (a) có mực ở TÂM ô theo vị trí LAYOUT (không
    // phải theo offset dò rộng — offset rộng có thể nằm trên nét in), và
    // (b) mực không trải thành dải xuyên ô (nét in). Đo trên phiếu render tô
    // thật và 40 trang scan: mực tô lấp tâm ≥0.10 và bbox ≤2.6r; ô trống chỉ
    // có vòng in (bbox 33×33 ≈ 4.6r) hoặc dây kẻ (33×5), tâm phủ ~0.00–0.02.
    const innerCov = digitsClean.map((d, di) => {
      if (d < 0) return -1;
      const b = q.columns[di].bubbles[d];
      const ri = Math.max(2, Math.round(b.r * Math.min(sx, sy) * 0.5));
      // đo tại vị trí LAYOUT (không cộng offset refine)
      return inkCoverage(ink, b.x * sx, b.y * sy, ri);
    });
    const guardOn = process.env.CHAMBAI_NO_GUARD !== "1";
    // Lọc 1 — MỰC TẠI VỊ TRÍ LAYOUT (không cộng offset dò). Đây là đặc trưng
    // tách bạch nhất, đo trên 4 nhóm dữ liệu: ô TÔ THẬT 1.00 (render + scan
    // fixture 40 ô), ảnh chụp 0.54–0.85; ô TRỐNG (nét in bị dò trúng) 0.00–0.61.
    // Nội dung thật luôn có mực NGAY TẠI Ô; nét in thì nằm LỆCH (offset dò mới
    // chạm tới) → đo tại layout phân biệt được dù offset đã trượt.
    let digitsDense = digitsClean.map((d, di) =>
      guardOn && d >= 0 && innerCov[di] >= 0 && innerCov[di] < 0.3 ? -1 : d,
    );
    // Lọc 2 — CẢ CÂU cùng một chữ số HÀNG BIÊN (0 hoặc 9) mà mực phủ trung
    // bình thấp: dây lưới viền dưới/trên thấm vào cửa sổ hàng cuối/đầu của
    // cả 4 cột cùng lúc (đo a-1/a-3: cả câu đọc "9999" trên ô trống). Câu có
    // mực thật (phủ trung bình ≥ 0.25 —vd học sinh tô "9 0 0") không bị lọc.
    // Lọc 2 — CẢ CÂU cùng một chữ số HÀNG BIÊN (0/9) + mực tâm-layout KHÔNG
    // đầy đặn: dây lưới viền dưới/trên hắt vào cả 4 cột của hàng cuối/đầu
    // (đo Tin 12: mọi cột ra "9999"/"0000" trên ô trống, tâm 0.33–0.51). Học
    // sinh tô thật cùng một chữ số 4 cột là cực hiếm; nếu có thì tâm-layout
    // vẫn ≥0.54 (đo ảnh chụp thật) nên không bị chặn oan.
    const decidedIdx = digitsDense.map((d, i) => (d >= 0 ? i : -1)).filter(i => i >= 0);
    if (guardOn && decidedIdx.length >= 3) {
      const decided = decidedIdx.map(i => digitsDense[i]);
      const avgIn = decidedIdx.reduce((s, i) => s + Math.max(0, innerCov[i]), 0) / decidedIdx.length;
      // Đếm số cột cùng một chữ số HÀNG BIÊN: 3–4 cột giống nhau mà mực tâm
      // thấp là dấu hiệu nét in (a-4 đo được 2/4 cột "9" tâm 0.35 — bắt bằng
      // nhánh 3 cột này khi lưới lệch nhẹ).
      const counts = new Map<number, number>();
      for (const d of decided) counts.set(d, (counts.get(d) ?? 0) + 1);
      let maxSame = 0;
      let maxDigit = -1;
      for (const [d, c] of counts) if (c > maxSame) { maxSame = c; maxDigit = d; }
      const edgeRun = (maxDigit === 0 || maxDigit === 9) && maxSame >= 3 && avgIn < 0.53;
      const fullRun = decided.every(d => d === decided[0]) && avgIn < 0.53;
      if ((edgeRun || fullRun) && (maxDigit === 0 || maxDigit === 9)) {
        digitsDense = digitsDense.map(() => -1);
      }
    }
    const signs = q.signs ? readSignRow(ink, q.signs, offs, digitBox) : null;
    return { digits: digitsDense, signs };
  });
  const part3 = part3Rows.map((r) => r.digits);
  const part3Signs = part3Rows.map((r) => r.signs);

  /**
   * Đọc khối mã đề / SBD với CẠNH TRANH 2 lưới: toạ độ chuẩn vs toạ độ refit
   * (refit lưới theo vành ô in — cứu ảnh warp xiên). Chọn bản có tổng độ tin
   * cậy cao hơn (mực tại ô quyết định) → không bao giờ tệ hơn đọc chuẩn, và
   * tự nhận refit khi nó đúng. Ảnh méo nặng mà refit "sửa bậy" sẽ thua vì
   * điểm mực rơi xuống nền.
   */
  const confidence = (cols: { bubbles: { x: number; y: number; r: number }[] }[]) =>
    cols.reduce((acc, col) => {
      const boxes = col.bubbles.map((b) => digitBox(b, 0, 0));
      const scores = readBubbleRowScores(ink, boxes);
      return acc + scores.reduce((a, b) => (b > a ? b : a), 0);
    }, 0);

  let examCode: string | null = null;
  if (opts.readExamCode && layout.examCode) {
    const base = layout.examCode.columns;
    const digits = readDigitBlock(ink, base, digitBox, allowRefine);
    let bestCols = base;
    let bestDigits = digits;
    let bestConf = confidence(base);
    const refit = refineGridBubbles(ink, base);
    if (refit) {
      const d2 = readDigitBlock(ink, refit, digitBox, allowRefine);
      const c2 = confidence(refit);
      if (c2 > bestConf) { bestCols = refit; bestDigits = d2; bestConf = c2; }
    }
    void bestCols;
    // Join all digits (leading blanks drop out naturally). 4-col grids keep
    // the full code ("1132") — key matching handles 3-digit tails.
    const joined = bestDigits.map((d) => (d >= 0 ? String(d) : "")).join("");
    examCode = joined.length ? joined : null;
  }

  let studentCode: string | null = null;
  if (opts.readStudentCode && layout.studentCode) {
    const base = layout.studentCode.columns;
    const digits = readDigitBlock(ink, base, digitBox, allowRefine);
    let bestDigits = digits;
    let bestConf = confidence(base);
    const refit = refineGridBubbles(ink, base);
    if (refit) {
      const d2 = readDigitBlock(ink, refit, digitBox, allowRefine);
      const c2 = confidence(refit);
      if (c2 > bestConf) { bestDigits = d2; }
    }
    studentCode = bestDigits.map((d) => (d >= 0 ? String(d) : "-")).join("");
  }

  // CHẶN Ô MA PHẦN I/II (yêu cầu 2026-11-17): câu ĐÃ QUYẾT nhưng mật độ mực
  // tại tâm ô < 20% là nhiễu nền của scan nhạt — trả về bỏ trống. Không chặn
  // thì ảnh kết quả vẽ vòng xanh "ma" trên ô trống (câu 34/36/38 của phiếu
  // để trống cột 31–40) và điểm bị trừ oan. Đo 517 ô thật: coverage ≥ 0.27.
  for (const q of questions) {
    if (process.env.CHAMBAI_NO_GUARD === "1") break;
    if (q.answer < 0 || !q.center) continue;
    const lq = layout.questions[q.index];
    const b = lq?.bubbles[q.answer];
    if (!b) continue;
    const rr = Math.max(2, Math.round(b.r * Math.min(sx, sy) * 0.8));
    if (inkCoverage(ink, q.center.x, q.center.y, rr) < 0.2) {
      q.answer = -1;
      q.unsure = false;
    }
  }

  return { questions, part3, part3Signs, examCode, studentCode, readError };
}

/** Convert question answers to the compact form the store keeps. */
export function toAnswerArray(questions: SheetReadInternal["questions"]): number[] {
  return questions.map((q) => q.answer);
}

/** Draw answer bubbles (+ PHẦN III digits) + score text onto a warped preview. */
export interface AnnotateSpace {
  /**
   * Kích thước (px) của KHÔNG GIAN CHUẨN dùng để tính toạ độ lưới đáp án.
   * Bỏ trống = trùng kích thước ảnh đích (chế độ warp cũ).
   */
  width: number;
  height: number;
  /**
   * Ánh xạ một điểm từ không gian chuẩn sang ảnh đích. Bỏ trống = giữ nguyên.
   * Dùng để vẽ lưới lên ẢNH GỐC (không warp): toạ độ bubble canonical được
   * chiếu về đúng vị trí trên ảnh chụp.
   */
  mapPoint?: (p: Pt) => Pt;
}

export function annotateSheet(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  layout: SheetLayout,
  questions: SheetReadInternal["questions"],
  keyAnswers: number[] | null,
  scoreText: string | null,
  part3?: number[][],
  examCode?: string | null,
  studentCode?: string | null,
  part3Signs?: ({ neg: boolean; comma: number } | null)[],
  space?: AnnotateSpace,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  /** Không gian CHUẨN để tính toạ độ lưới (mặc định = ảnh đích). */
  const sw = space?.width ?? width;
  const sh = space?.height ?? height;
  const minSide = Math.min(sw, sh);
  const mapPoint = space?.mapPoint;

  /** Hệ số phóng bán kính: ảnh đích có thể khác kích thước không gian chuẩn. */
  const radiusScaleAt = (p: Pt) => {
    if (!mapPoint) return Math.min(width / sw, height / sh) || 1;
    const o = mapPoint(p);
    const q = mapPoint({ x: p.x + 10, y: p.y });
    const d = Math.hypot(q.x - o.x, q.y - o.y) / 10;
    return Number.isFinite(d) && d > 0 ? d : 1;
  };

  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    const i = (yi * width + xi) * 4;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  };

  /**
   * BIÊN VÙNG ĐÁP ÁN (toạ độ không gian chuẩn) — chặn vẽ vòng ra ngoài vùng
   * này (yêu cầu 2026-11-17: "bubble xanh/đỏ dư nằm ngoài vùng đáp án").
   * Lấy từ chính layout: bao mọi bubble của questions + part3, nới 1.5 bán
   * kính ô để vòng hợp lệ ở mép vẫn vẽ trọn. Vòng lạc (do shift/snap hỏng)
   * rơi ra ngoài → KHÔNG vẽ, tránh ảnh kết quả có vòng vô nghĩa ở lề/khối
   * điểm/mã đề.
   */
  const allBubbles = [
    ...layout.questions.flatMap((q) => q.bubbles),
    ...layout.part3.flatMap((q) => q.columns.flatMap((c) => c.bubbles)),
  ];
  const padX = (allBubbles[0]?.r ?? 0.008) * minSide * 1.6;
  const ansBounds = allBubbles.length
    ? {
        x0: Math.min(...allBubbles.map((b) => b.x * sw)) - padX,
        x1: Math.max(...allBubbles.map((b) => b.x * sw)) + padX,
        y0: Math.min(...allBubbles.map((b) => b.y * sh)) - padX,
        y1: Math.max(...allBubbles.map((b) => b.y * sh)) + padX,
      }
    : null;

  /**
   * LƯỚI Ô THEO HÀNG×CỘT: nhóm tâm bubble theo hàng (y) và cột (x) sau khi
   * làm tròn về bước nhỏ — dùng để kiểm tra "vòng này có nằm ĐÚNG một ô của
   * lưới không". Khoảng trống giữa các phần (vd y 33.6% < P1 36.7%, hoặc
   * x 50% giữa khối cột 2 và 3 của GIAY12) KHÔNG có ô → vòng ở đó là lạc.
   *
   * Đo ảnh báo cáo (3 ảnh preview GIAY12): 3 vòng dư cùng ở y=33.6%,
   * x=49.5–53.9% — nằm trong khoảng trống header→P1 và giữa khối 2/3, do
   * shift 8.7×r của bản cũ. Cổng này chặn tuyệt đối các vòng như vậy.
   */
  const answerGrid = (() => {
    if (!allBubbles.length) return null;
    const xCells = allBubbles.map((b) => b.x * sw);
    const yCells = allBubbles.map((b) => b.y * sh);
    const rPx = (allBubbles[0].r ?? 0.008) * minSide;
    // dung sai: 1.5 bán kính ô (đủ cho lệch in + bán kính vòng vẽ)
    const tol = Math.max(3, rPx * 1.5);
    // tâm cột/hàng duy nhất (gộp các giá trị sát nhau)
    const uniq = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const out: number[] = [];
      for (const v of s) if (!out.length || v - out[out.length - 1] > tol * 0.8) out.push(v);
      return out;
    };
    return { cols: uniq(xCells), rows: uniq(yCells), tol };
  })();
  /**
   * Tâm vòng có nằm trên một Ô của lưới (một cột × một hàng) không?
   * Không khớp cả hàng lẫn cột ⇒ vòng lạc, không vẽ.
   */
  const onAnswerGrid = (x: number, y: number) => {
    if (!answerGrid) return true;
    const nearAny = (vals: number[], v: number) => vals.some((c) => Math.abs(c - v) <= answerGrid.tol);
    return nearAny(answerGrid.cols, x) && nearAny(answerGrid.rows, y);
  };
  const insideAnswerArea = (x: number, y: number) =>
    (!ansBounds || (x >= ansBounds.x0 && x <= ansBounds.x1 && y >= ansBounds.y0 && y <= ansBounds.y1)) &&
    onAnswerGrid(x, y);

  /** Vẽ vòng tròn tại toạ độ KHÔNG GIAN CHUẨN (tự chiếu sang ảnh đích). */
  const drawCircle = (cx: number, cy: number, radius: number, color: [number, number, number], thickness = 2) => {
    // Bỏ vòng KHÔNG thuộc ô nào của lưới đáp án (ngoài bao / trong khoảng trống
    // giữa các phần) — dấu hiệu toạ độ đã trôi (snap/shift hỏng).
    if (!insideAnswerArea(cx, cy)) return;
    const scale = radiusScaleAt({ x: cx, y: cy });
    const cxT = mapPoint ? mapPoint({ x: cx, y: cy }).x : cx;
    const cyT = mapPoint ? mapPoint({ x: cx, y: cy }).y : cy;
    if (!Number.isFinite(cxT) || !Number.isFinite(cyT)) return;
    const radiusT = radius * scale;
    const thickT = Math.max(1, thickness * Math.min(3, Math.max(0.6, scale)));
    for (let t = 0; t < thickT; t++) {
      const r = radiusT - t;
      if (r <= 0) break;
      const steps = Math.max(16, Math.round(r * 6));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        setPixel(cxT + Math.cos(a) * r, cyT + Math.sin(a) * r, ...color);
      }
    }
  };

  for (const q of questions) {
    const layoutQ = layout.questions[q.index];
    if (!layoutQ) continue;
    const correct = keyAnswers ? keyAnswers[q.index] : undefined;
    // Khoanh đúng chỗ ô IN đã đọc, không phải toạ độ chuẩn: lưới in lệch thì
    // vòng khoanh phải nằm trên ô thật. Độ lệch đo được ở ô vừa đọc được áp
    // cho cả hàng (các ô trong hàng in cùng một lưới).
    // `q.center` là toạ độ trong KHÔNG GIAN CHUẨN (ảnh đã warp) mà bộ đọc dùng.
    //
    // ⚠️ CỔNG BIÊN ĐỘ SHIFT (yêu cầu 2026-11-17 — "bubble xanh/đỏ dư nằm ngoài
    // vùng đáp án"): snap dựa trên centroid mực nên khi ô trống/lưới in lệch,
    // centroid có thể trôi rất xa → shift lớn áp cho CẢ HÀNG → vòng vẽ ra
    // ngoài vòng ô, có khi ra ngoài vùng đáp án (đo ảnh người dùng: vòng lệch
    // 13.7–20.2px, dx hệ thống ±0.4–0.6%). Giới hạn shift trong 1.2 × bán kính
    // ô — quá mức đó là snap hỏng, dùng toạ độ layout (chính xác hơn nhiều so
    // với vòng vẽ lạc).
    const bubbleR = layoutQ.bubbles[0]?.r ?? 0.008;
    const shiftLimitX = Math.max(2, bubbleR * minSide * 1.2);
    let shift = q.center && q.answer >= 0
      ? {
          dx: q.center.x - layoutQ.bubbles[q.answer].x * sw,
          dy: q.center.y - layoutQ.bubbles[q.answer].y * sh,
        }
      : { dx: 0, dy: 0 };
    if (Math.hypot(shift.dx, shift.dy) > shiftLimitX) shift = { dx: 0, dy: 0 };
    const at = (i: number) => ({
      x: layoutQ.bubbles[i].x * sw + shift.dx,
      y: layoutQ.bubbles[i].y * sh + shift.dy,
    });

    // VÒNG XANH LỤC — ĐÁP ÁN ĐÚNG (yêu cầu 2026-11-17: BỎ màu xanh dương,
    // thay bằng xanh lục). Khoanh tại ô đáp án của key để nhìn phát hiện ngay ô
    // phải tô. Không vẽ vòng key khi học sinh đã tô ĐÚNG ô đó — nhánh học sinh
    // bên dưới đã vẽ vòng lục ×1.5, tránh 2 vòng lục lồng nhau.
    if (
      correct !== undefined &&
      correct >= 0 &&
      correct < layoutQ.bubbles.length &&
      q.answer !== correct
    ) {
      const kp = at(correct);
      const outer = q.answer < 0; // bỏ trống → vòng lớn bao ngoài vòng vàng
      drawCircle(kp.x, kp.y, layoutQ.bubbles[correct].r * minSide * (outer ? 1.9 : 1.5), [22, 163, 74], 2);
    }

    if (q.answer >= 0) {
      const p = at(q.answer);
      const isRight = correct === undefined || correct === -1 || correct === q.answer;
      drawCircle(p.x, p.y, layoutQ.bubbles[q.answer].r * minSide * 1.5, isRight ? [22, 163, 74] : [220, 38, 38], 3);
    } else if (q.answer === -2) {
      /**
       * TÔ NHIỀU Ô trong cùng một ý (PHẦN I: 2+ phương án; PHẦN II: cả Đ và S —
       * yêu cầu 2026-11-17). Bộ đọc trả -2 (multi) để KHÔNG chấm điểm cho ý
       * đó, nhưng trước đây ảnh kết quả KHÔNG vẽ gì (điều kiện `answer >= 0`)
       * và lại vẽ vòng vàng "bỏ trống" ở ô đáp án — nhìn như học sinh để
       * trống, mất dấu ô đã tô kép. Nay khoanh CAM (234,88,12) trên MỌI ô học
       * sinh đã tô (lấy từ `scores` của chính hàng) để giáo viên thấy ngay chỗ
       * tô nhiều đáp án; vòng xanh lục đáp án đúng vẫn giữ ở trên.
       */
      const sc = q.scores ?? [];
      const filled: number[] = [];
      for (let i = 0; i < layoutQ.bubbles.length && i < sc.length; i++) {
        if (sc[i] > FILL_THRESHOLD) filled.push(i);
      }
      if (filled.length >= 2) {
        for (const i of filled) {
          const p = at(i);
          drawCircle(p.x, p.y, layoutQ.bubbles[i].r * minSide * 1.55, [234, 88, 12], 3);
        }
      } else if (correct !== undefined && correct >= 0) {
        // Không lấy được danh sách ô (scores rỗng): ít nhất khoanh vàng ô đáp
        // án để không mất hoàn toàn dấu hiệu "không đọc được ý này".
        const p = at(correct);
        drawCircle(p.x, p.y, layoutQ.bubbles[correct].r * minSide * 1.5, [234, 179, 8], 2);
      }
    } else if (correct !== undefined && correct >= 0) {
      const p = at(correct);
      drawCircle(p.x, p.y, layoutQ.bubbles[correct].r * minSide * 1.5, [234, 179, 8], 2);
    }
  }

  // PHẦN III digits: khoanh chữ số học sinh đã tô; ô BỎ TRỐNG mà đáp án có
  // thì khoanh VÀNG — giống PHẦN I/II. Nhờ vậy nhìn ảnh là biết chữ số nào
  // của đáp án bị thiếu, không chỉ thấy các ô đã tô.
  if (part3 && part3.length) {
    const perCau = part3[0]?.length ?? 4;
    part3.forEach((cols, ci) => {
      cols.forEach((digit, di) => {
        const q = layout.part3[ci];
        const col = q?.columns[di];
        if (!col) return;
        const gIdx = layout.questions.length + ci * perCau + di;
        const correct = keyAnswers ? keyAnswers[gIdx] : undefined;
        // Vòng XANH LỤC đáp án đúng cho ô chữ số (yêu cầu 2026-11-17: bỏ xanh
        // dương). Bỏ vòng khi học sinh đã tô đúng ô đó (nhánh dưới vẽ rồi).
        if (correct !== undefined && correct >= 0 && correct < col.bubbles.length && digit !== correct) {
          const kb = col.bubbles[correct];
          const outer = digit < 0;
          drawCircle(kb.x * sw, kb.y * sh, kb.r * minSide * (outer ? 1.9 : 1.5), [22, 163, 74], 2);
        }
        if (digit >= 0) {
          const b = col.bubbles[digit];
          if (!b) return;
          const isRight = correct === undefined || correct === -1 || correct === digit;
          drawCircle(b.x * sw, b.y * sh, b.r * minSide * 1.5, isRight ? [22, 163, 74] : [220, 38, 38], 3);
        } else if (correct !== undefined && correct >= 0) {
          const b = col.bubbles[correct];
          if (b) drawCircle(b.x * sw, b.y * sh, b.r * minSide * 1.5, [234, 179, 8], 2);
        }
      });
    });
  }

  // PHẦN III ô dấu: ô ĐÃ TÔ → xanh/đỏ; ô đáp án CÓ mà học sinh bỏ trống →
  // VÀNG. Nếu thiếu phần này thì học sinh quên tô dấu "−" sẽ không thấy dấu
  // trừ của đáp án ở đâu cả, dù điểm đã bị trừ.
  if (part3Signs && part3Signs.length) {
    const digitSlots = layout.questions.length + layout.part3.reduce((s, c) => s + c.columns.length, 0);
    let signIdx = 0;
    layout.part3.forEach((q, ci) => {
      const s = part3Signs[ci];
      if (!q.signs) return;
      const negIdx = digitSlots + signIdx * 2;
      const keyNeg = keyAnswers ? keyAnswers[negIdx] : undefined;
      const keyComma = keyAnswers ? keyAnswers[negIdx + 1] : undefined;
      const at = (b: { x: number; y: number; r: number }) => ({
        x: b.x * sw,
        y: b.y * sh,
        r: b.r * minSide * 1.5,
      });
      // Dấu trừ
      const neg = at(q.signs.neg);
      if (s?.neg) {
        const isRight = keyNeg === undefined || keyNeg === -1 || keyNeg === 0;
        drawCircle(neg.x, neg.y, neg.r, isRight ? [22, 163, 74] : [220, 38, 38], 3);
      } else if (keyNeg === 0) {
        drawCircle(neg.x, neg.y, neg.r, [234, 179, 8], 2);
      }
      // Dấu thập phân
      if (s && s.comma >= 0) {
        const b = at(s.comma === 0 ? q.signs.comma1 : q.signs.comma2);
        const isRight = keyComma === undefined || keyComma === -1 || keyComma === s.comma;
        drawCircle(b.x, b.y, b.r, isRight ? [22, 163, 74] : [220, 38, 38], 3);
      } else if (keyComma === 0 || keyComma === 1) {
        const b = at(keyComma === 0 ? q.signs.comma1 : q.signs.comma2);
        drawCircle(b.x, b.y, b.r, [234, 179, 8], 2);
      }
      signIdx++;
    });
  }

  if (scoreText) {
    /**
     * Khối kết quả đặt NGAY SAU chữ "PHẦN I / II / III" in trên phiếu, cỡ chữ
     * gấp đôi bản cũ, theo bố cục app gốc (omr_sheetgrid.py):
     *   hàng PHẦN I  : P1 · Tong · MD · SBD
     *   hàng PHẦN II : P2
     *   hàng PHẦN III: P3
     */
    const pick = (label: string) =>
      scoreText.split("\n").find((l) => l.startsWith(label)) ?? null;
    const bodyOf = (line: string | null, label: string) =>
      line ? line.slice(label.length).trim() : null;
    const mdCode = examCode ?? bodyOf(pick("Ma de:") ?? pick("MD:"), "Ma de:") ?? bodyOf(pick("MD:"), "MD:");

    /** "18/18=6.00" → "18/18 = 6.00" (dấu = có khoảng trắng cho dễ đọc). */
    const withSpacedEq = (raw: string | null) => {
      if (!raw) return null;
      const eq = raw.lastIndexOf("=");
      return eq < 0 ? raw : `${raw.slice(0, eq).trim()} = ${raw.slice(eq + 1).trim()}`;
    };
    /** P2 nhiều nhóm: "8/8=2.00; 8/8=2.00; 0/0=0.00=4.00" → "8/8; 8/8; 0/0 = 4.00" */
    const compactP2 = (raw: string | null) => {
      if (!raw) return null;
      const groups = raw.split(";").map((g) => g.trim());
      const last = groups[groups.length - 1] ?? "";
      const total = last.includes("=") ? last.split("=").pop()!.trim() : "";
      return `${groups.map((g) => g.split("=")[0].trim()).join("; ")}${total ? ` = ${total}` : ""}`;
    };

    const p1Body = bodyOf(pick("P1:"), "P1:");
    const tongBody = bodyOf(pick("Tong:"), "Tong:");
    // Ma de/SBD: dùng code đọc được nếu có, nếu không thì lấy từ scoreText.
    const sbdCode = studentCode ?? bodyOf(pick("SBD:"), "SBD:");
    const p2Body = compactP2(bodyOf(pick("P2:"), "P2:"));
    const p3Body = bodyOf(pick("P3:"), "P3:");

    /**
     * Phiếu KHÔNG chia phần (mẫu tự thiết kế A4/A6/A8): scoreText chỉ có một
     * dòng "8/10=8.00", không có nhãn P1/P2/P3/Tong → trước đây không dòng nào
     * khớp nên ảnh preview KHÔNG có chữ điểm. Hiện thành một dòng "Tong: …".
     */
    const plainBody =
      p1Body || tongBody || p2Body || p3Body
        ? null
        : (scoreText.trim().split("\n").pop() ?? "").trim() || null;
    const totalBody = tongBody ?? plainBody;

    const row1 = [
      p1Body ? `P1: ${withSpacedEq(p1Body)}` : null,
      totalBody ? `Tong: ${withSpacedEq(totalBody)}` : null,
      sbdCode ? `SBD: ${sbdCode}` : null,
    ].filter(Boolean) as string[];
    /**
     * P2 hiện khi phiếu CÓ PHẦN II (`part2Count > 0`) — mẫu kết quả yêu cầu đủ
     * P1/P2/P3 nên kể cả đáp án không có câu Đ/S nào vẫn in "P2: 0/0 = 0.00".
     * Phiếu tự thiết kế A4/A6/A8 KHÔNG có PHẦN II: in dòng P2 sẽ nằm chơ vơ
     * giữa trang (anchor 0.5) và gây hiểu nhầm.
     */
    const row2 = layout.part2Count > 0 ? [`P2: ${p2Body ?? "0/0 = 0.00"}`] : [];
    const row3 = p3Body ? [`P3: ${withSpacedEq(p3Body)}`] : [];
    const box = layout.scoreBox;
    if (!row1.length && !row2.length && !row3.length) {
      // không có nội dung — bỏ qua
    } else if (box) {
      /**
       * Mẫu có khung "Điểm bài kiểm tra" in sẵn (Giấy 10-11): mỗi mục một ô,
       * theo đúng thứ tự in trên phiếu — P1, P2, P3, Tong, MĐ, SBD. Cỡ chữ
       * 0.016H (nửa khối cũ), tự co nếu mục dài hơn bề rộng ô.
       */
      /**
       * P2 hiển thị dạng GỘP: "8/8; 8/8; 0/0 = 2.00". LUÔN có dòng P2 (kể cả khi
       * đáp án không có câu Đ/S nào → "0/0 = 0.00"): trước đây trả null khi
       * c=0,t=0 nên ô P2 trong khung "Điểm bài kiểm tra" bị bỏ trống, ảnh kết
       * quả thiếu hẳn PHẦN II.
       */
      const p2TotalLine = (() => {
        const raw = bodyOf(pick("P2:"), "P2:");
        if (!raw) return "0/0 = 0.00";
        const groups = raw.split(";").map((g) => g.trim());
        let c = 0;
        let t = 0;
        for (const g of groups) {
          const m = g.split("=")[0].match(/^(\d+)\/(\d+)$/);
          if (!m) continue;
          c += Number(m[1]);
          t += Number(m[2]);
        }
        const last = groups[groups.length - 1] ?? "";
        const total = last.includes("=") ? last.split("=").pop()!.trim() : "";
        return `${c}/${t}${total ? ` = ${total}` : ""}`;
      })();

      // Giữ ĐÚNG ô cho từng mục (không dồn lên khi thiếu): phiếu không có P2
      // thì P3 vẫn nằm ở ô P3, không nhảy vào ô P2.
      const items: (string | null)[] = [
        p1Body ? `P1: ${withSpacedEq(p1Body)}` : null,
        layout.part2Count > 0 ? `P2: ${p2TotalLine}` : null,
        p3Body ? `P3: ${withSpacedEq(p3Body)}` : null,
        totalBody ? `Tong: ${withSpacedEq(totalBody)}` : null,
        sbdCode ? `SBD: ${sbdCode}` : null,
      ];

      const ADVANCE = box.advance ?? 0.42;
      const baseFs = Math.max(8, Math.round(sh * (box.fs ?? 0.016)));
      /**
       * Cỡ chữ ĐỒNG NHẤT giữa các dòng: tính sẵn fs của từng mục rồi dùng MIN —
       * trước đây mỗi dòng tự co riêng nên "P1: …" (16 ký tự) nhỏ hơn "Tong: …"
       * (10 ký tự) dù cùng ô, nhìn không phải một khối kết quả.
       */
      const slotOf = (i: number) => box.slots[Math.min(i, box.slots.length - 1)];
      const fsStdOf = (line: string, i: number) => {
        const slot = slotOf(i);
        if (!slot) return baseFs;
        const availW = sw * (slot.maxX - slot.x);
        return Math.max(8, Math.min(baseFs, Math.floor(availW / (Math.max(1, line.length) * ADVANCE))));
      };
      const fsStd = Math.min(baseFs, ...items.map((line, i) => (line ? fsStdOf(line, i) : baseFs)));
      items.forEach((line, i) => {
        if (!line) return;
        const slot = slotOf(i);
        if (!slot) return;
        const anchor = { x: slot.x * sw, y: slot.y * sh };
        const pos = mapPoint ? mapPoint(anchor) : anchor;
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
        const fs = Math.max(8, Math.round(fsStd * radiusScaleAt(anchor)));
        drawText(out, width, height, line, Math.round(pos.x), Math.round(pos.y), fs, [200, 30, 30], ADVANCE);
      });

      // MÃ ĐỀ ĐANG CHẤM: vẽ vào ô riêng (box.mdSlot — thường là ô "Phách" trống
      // cạnh khung điểm), prefix theo mẫu (MOI: chỉ số; Giấy 10-11: "MD: ").
      if (box.mdSlot && mdCode) {
        const mdLine = `${box.mdPrefix ?? "MD: "}${mdCode}`;
        const anchor = { x: box.mdSlot.x * sw, y: box.mdSlot.y * sh };
        const pos = mapPoint ? mapPoint(anchor) : anchor;
        if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          const availW = sw * (box.mdSlot.maxX - box.mdSlot.x);
          const fsMd = Math.max(8, Math.min(baseFs, Math.floor(availW / (mdLine.length * ADVANCE))));
          const fs = Math.max(8, Math.round(fsMd * radiusScaleAt(anchor)));
          drawText(out, width, height, mdLine, Math.round(pos.x), Math.round(pos.y), fs, [200, 30, 30], ADVANCE);
        }
      }
    } else {
      // --- Cỡ chữ: gấp đôi bản cũ (0.016H), tự co nếu hàng dài nhất tràn khung.
      /**
       * Vị trí + cỡ chữ theo đúng mẫu kết quả:
       *   PHẦN I  (in sẵn) → "P1: …  Tong: …  Ma de: …  SBD: …"  CÙNG DÒNG
       *   PHẦN II (in sẵn) → "P2: …"
       *   PHẦN III(in sẵn) → "P3: …"
       * Cỡ chữ = cỡ nhãn "PHẦN …" in sẵn trên phiếu: Times New Roman Bold
       * 11pt ⇒ ink cao ~7.5–8.6pt ≈ 1.5–1.7% chiều cao trang; glyph bitmap
       * cần size ≈ 0.022H để ink đạt cỡ đó (trước dùng 0.032H — to hơn hẳn).
       */
      const FS_RATIO = 0.022;
      const GAP = 0.018; // khoảng cách giữa các mục trên một hàng
      // Giữ tỉ lệ advance hẹp để chữ không tràn khỏi vùng in; bề rộng glyph
      // vẫn đủ dày để đọc ở ảnh 1000px.
      const ADVANCE = 0.62;
      /** Bắt đầu ngay sau nhãn "PHẦN …" in sẵn (kết thúc ~x 0.13 trên phiếu). */
      const X_LABEL_END: Record<string, number> = {
        QM_A4: 0.135,
        GIAY12: 0.145,
        GIAY10_11: 0.14,
        MOI: 0.135,
      };
      const kind = (layout.kind ?? "QM_A4") as string;
      const X0 = X_LABEL_END[kind] ?? 0.14;
      const charsOf = (lines: string[]) => lines.reduce((n, l) => n + l.length, 0);
      const gapsOf = (lines: string[]) => Math.max(0, lines.length - 1) * GAP * sw;
      const fitFs = (lines: string[], x0: number) => {
        if (!lines.length) return Number.POSITIVE_INFINITY;
        const avail = sw * (0.99 - x0) - gapsOf(lines);
        return Math.floor(avail / (charsOf(lines) * ADVANCE));
      };
      let fs = Math.round(sh * FS_RATIO);
      for (const [lines, x0] of [
        [row1, X0],
        [row2, X0],
        [row3, X0],
      ] as [string[], number][]) {
        fs = Math.min(fs, fitFs(lines, x0));
      }
      fs = Math.max(10, fs);

      /**
       * y: chữ kết quả nằm CÙNG DÒNG với nhãn "PHẦN …" in sẵn — nhãn in ở ngay
       * trên bubble đầu tiên của phần, nên đặt text sao cho ĐÁY chữ trùng đáy
       * nhãn (khoảng 1.9 × fs phía trên bubble đầu, đúng chiều cao nhãn 11pt).
       * Trước đây đặt sát bubble (0.3 fs trên) nên chữ nằm lệch xuống dưới nhãn.
       */
      const rowYFor = (firstBubbleY: number, r: number) => {
        const bubbleTop = firstBubbleY * sh - r * minSide;
        return Math.round(bubbleTop - fs * 1.9);
      };
      const p1Q = layout.questions[0];
      const p2Q = layout.questions[layout.part1Count];
      const p3Q = layout.part3[0];
      const r1 = p1Q?.bubbles[0]?.r ?? 0.008;
      const y1 = rowYFor(p1Q?.bubbles[0]?.y ?? 0.3, r1);
      const y2 = rowYFor(p2Q?.bubbles[0]?.y ?? 0.5, r1);
      const y3 = rowYFor(p3Q?.columns[0]?.bubbles[0]?.y ?? 0.75, r1);

      /**
       * Điểm KẾT THÚC của nhãn "PHẦN …" in sẵn (tỉ lệ bề rộng trang) — đo từ
       * chính PDF/ảnh mẫu của từng phiếu. Chữ đỏ đặt NGAY SAU mốc này để không
       * đè lên nhãn và nằm cùng dòng với nhãn (đúng mẫu kết quả yêu cầu).
       *   MOI      : "PHẦN I/II" kết thúc 0.143; "PHẦN III" dài hơn → 0.249
       *   GIAY12   : nhãn hẹp, kết thúc ≈ 0.111
       *   QM_A4    : ≈ 0.132 (chữ nhỏ hơn, xa lề hơn)
       *   GIAY10_11: nhãn nằm sát lề trái ≈ 0.10
       */
      const LABEL_END: Record<string, number> = {
        MOI: 0.155,
        GIAY12: 0.121,
        QM_A4: 0.142,
        GIAY10_11: 0.112,
      };
      const labelEnd = (rowIdx: 0 | 1 | 2): number => {
        const kind = (layout.kind ?? "QM_A4") as string;
        let v = LABEL_END[kind] ?? 0.142;
        // "PHẦN III" dài hơn "PHẦN I/II" ở mẫu MOI — chữ đỏ P3 phải lùi xa hơn.
        if (kind === "MOI" && rowIdx === 2) v = 0.262;
        return v;
      };

      const drawRow = (lines: string[], x0: number, y: number, rowIdx: 0 | 1 | 2) => {
        let x = Math.round(Math.max(x0, labelEnd(rowIdx)) * sw);
        const gap = Math.round(GAP * sw);
        for (const line of lines) {
          // Toạ độ chuẩn → ảnh đích; cỡ chữ nhân theo tỉ lệ cục bộ.
          const anchor = { x, y };
          const pos = mapPoint ? mapPoint(anchor) : anchor;
          const fsT = Math.max(8, Math.round(fs * radiusScaleAt(anchor)));
          if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            drawText(out, width, height, line, Math.round(pos.x), Math.round(pos.y), fsT, [200, 30, 30], ADVANCE);
          }
          x += Math.round(line.length * fs * ADVANCE) + gap;
        }
      };
      drawRow(row1, X0, y1, 0);
      drawRow(row2, X0, y2, 1);
      drawRow(row3, X0, y3, 2);

      // NỘI DUNG MÃ ĐỀ — cạnh PHẢI nhãn "8. Mã đề thi" in sẵn, CÙNG DÒNG
      // (yêu cầu 2026-11-17: vị trí/font/màu như mẫu; bỏ chữ "MD: …" cũ đè
      // lưới tô). Dùng toạ độ label của layout (QM_A4: x 505, y 96, w 60 pt),
      // cỡ chữ bằng cỡ nhãn in.
      const ex = layout.examCode;
      if (ex?.label && mdCode) {
        // Vị trí NHƯ HÌNH MẪU (2026-11-17): TRÊN nhãn "8. Mã đề thi", CANH
        // PHẢI theo mép phải nhãn, cách nhãn ~nửa chiều cao nhãn — không đè
        // lưới tô phía dưới.
        const labelRight = (ex.label.x + ex.label.w) * sw;
        const fsMd = Math.max(10, Math.round(ex.label.h * sh));
        const mdWidth = mdCode.length * fsMd * 0.73;
        const anchor = {
          x: labelRight - mdWidth,
          y: Math.max(4, ex.label.y * sh - fsMd - ex.label.h * sh * 0.5),
        };
        const pos = mapPoint ? mapPoint(anchor) : anchor;
        if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          const fsT = Math.max(8, Math.round(fsMd * radiusScaleAt(anchor)));
          drawText(out, width, height, mdCode, Math.round(pos.x), Math.round(pos.y), fsT, [200, 30, 30], 0.73);
        }
      }
    }
  }

  return out;
}

/**
 * Mực tại ô có trải rộng quá `maxTimesR` lần bán kính ô theo BẤT KỲ chiều nào?
 * Dùng để nhận diện NÉT IN thay vì MỰC TÔ.
 *
 * Cửa sổ đo = 1.7×r (vừa đủ phủ ô + mép vòng in sát ô): cửa sổ rộng (2.5×r)
 * nuốt luôn nét in ô bên cạnh → mọi ô đều bị coi là "dải". MỰC TÔ chiếm trọn
 * ô nên trong cửa sổ 1.7r tạo khối đặc ≥ 1.4r mỗi chiều; VÒNG IN chỉ là nét
 * viền ngoài r ≈ 1r và DÂY KẺ LƯỚI thì dẹt (một chiều ≪ r) — cả hai cho bbox
 * MT KHÁC: mực tô lấp gần kín cửa sổ (fill cao), nét in chỉ là đường mảnh.
 */
function inkBboxExceeds(ink: GrayMat, cx: number, cy: number, rPx: number, maxTimesR: number): boolean {
  const half = Math.max(2, Math.round(1.7 * rPx));
  let x0 = 1e9;
  let x1 = -1;
  let y0 = 1e9;
  let y1 = -1;
  let n = 0;
  let tot = 0;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      tot++;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= ink.width || y >= ink.height) continue;
      if (ink.data[y * ink.width + x] === 0) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return false;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  // Chỉ coi là nét in khi bbox phủ GẦN HẾT chiều (nét in chạy xuyên qua ô) VÀ
  // đồng thời không phải khối đặc lấp đầy ô (mực tô thật lấp ô rất dày).
  const spans = w > maxTimesR * rPx || h > maxTimesR * rPx;
  const dense = n / Math.max(1, tot) > 0.62;
  return spans && !dense;
}

/**
 * Tỉ lệ diện tích có mực trong hình tròn bán kính rr quanh (cx, cy) trên bản
 * ink — dùng để chặn "ô ma": ô được quyết định nhưng mực phủ quá thấp là nhiễu
 * nền của scan nhạt (đo 12 trang Tin 12: ô thật ≥ 0.27, ô ma ≤ 0.20).
 */
function inkCoverage(ink: GrayMat, cx: number, cy: number, rr: number): number {
  let n = 0;
  let dark = 0;
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy > rr * rr) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= ink.width || y >= ink.height) continue;
      n++;
      if (ink.data[y * ink.width + x] !== 0) dark++;
    }
  }
  return n ? dark / n : 0;
}

/** Tiny bitmap font renderer for the score overlay (digits, letters, punctuation). */
function drawText(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  size: number,
  color: [number, number, number],
  /** Bước nhảy mỗi ký tự theo bội số của size (mặc định 0.73 = rộng rãi). */
  advance = 0.73,
) {
  let cx = x;
  if (advance >= 0.7) {
    const glyphW = Math.max(4, Math.round(size * 0.55));
    for (const ch of text) {
      drawGlyph(buf, width, height, ch, cx, y, glyphW, size, color);
      cx += glyphW + Math.round(size * 0.18);
    }
    return;
  }
  // Chữ to: nén bề ngang glyph để nhồi được nhiều ký tự hơn trên một hàng.
  const glyphW = Math.max(3, Math.round(size * (advance - 0.08)));
  for (const ch of text) {
    drawGlyph(buf, width, height, ch, cx, y, glyphW, size, color);
    cx += Math.round(size * advance);
  }
}

/**
 * Bộ glyph SERIF 5×7 cho chữ kết quả — dạng chữ có chân (serif) giống font in
 * sẵn trên phiếu (Times), thay cho bộ khối 3×5 cũ (yêu cầu 2026-11-17: "font
 * chữ của nội dung kết quả giống với nội dung Mã đề mới").
 */
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "11100", "00100", "00100", "00100", "00100", "11111"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01001", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00110", "01000"],
  ";": ["00000", "00110", "00110", "00000", "00110", "00110", "01000"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "o": ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  "n": ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  "g": ["00000", "00000", "01110", "10001", "10001", "01110", "00101"],
  "a": ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  "d": ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  "e": ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
};

function drawGlyph(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  ch: string,
  x: number,
  y: number,
  gw: number,
  gh: number,
  color: [number, number, number],
) {
  const pattern = GLYPHS[ch] ?? GLYPHS[" "];
  const rows = pattern.length;
  const cols = pattern[0].length;
  const cellW = gw / cols;
  const cellH = gh / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pattern[r][c] !== "1") continue;
      const x0 = Math.round(x + c * cellW);
      const y0 = Math.round(y + r * cellH);
      const x1 = Math.round(x + (c + 1) * cellW);
      const y1 = Math.round(y + (r + 1) * cellH);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const i = (yy * width + xx) * 4;
          buf[i] = color[0];
          buf[i + 1] = color[1];
          buf[i + 2] = color[2];
          buf[i + 3] = 255;
        }
      }
    }
  }
}
