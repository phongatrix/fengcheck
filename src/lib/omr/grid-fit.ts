/**
 * Hiệu chỉnh warp theo lưới đáp án (grid fit).
 *
 * Ảnh chụp thường cắt mất mép giấy hoặc paper quad dò sai mép → warp hiện tại
 * đặt lưới bubble lệch so với toạ độ chuẩn (trang bị "cắt đầu", dãn lệch).
 *
 * Hai lớp đo:
 *  1. `fitGridByProfile` — đối chiếu profile mực của PHẦN I với toạ độ dòng/cột
 *     chuẩn, tìm (scale, offset) theo từng trục. Đo được cả độ lệch LỚN (trượt
 *     vài phần trăm trang, vượt cửa sổ snap).
 *  2. `fitGridCorrection` — cặp (chuẩn → snap thực) của bubble có mực, fit affine
 *     tinh chỉnh phần dư sau bước 1.
 */

import type { Pt, SheetLayout } from "./types";
import { inkMap } from "./reader";


export interface GridPair {
  /** Vị trí chuẩn (canonical px) theo layout. */
  ex: number;
  ey: number;
  /** Vị trí snap thực trên ảnh đã warp. */
  ax: number;
  ay: number;
}

export interface AffineMap {
  /** actual = a·expected + b (tách theo trục). */
  apply: (p: Pt) => Pt;
  applyInverse: (p: Pt) => Pt;
}

/** Matrix helpers cho hệ affine 2 trục độc lập. */
function solve3(rows: number[][], rhs: number[]): number[] | null {
  const n = 3;
  const M = rows.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[pivot], M[col]] = [M[col], M[pivot]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
    if (!Number.isFinite(x[r])) return null;
  }
  return x;
}

function makeAffine(a1: number, a2: number, a3: number, b1: number, b2: number, b3: number): AffineMap | null {
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-6) return null;
  return {
    apply: (p: Pt) => ({ x: a1 * p.x + a2 * p.y + a3, y: b1 * p.x + b2 * p.y + b3 }),
    applyInverse: (p: Pt) => {
      const dx = p.x - a3;
      const dy = p.y - b3;
      return { x: (b2 * dx - a2 * dy) / det, y: (-b1 * dx + a1 * dy) / det };
    },
  };
}

/**
 * Toàn bộ dòng/cột chuẩn của lưới (P1 + P2 + P3 + mã đề/SBD) ở toạ độ canonical.
 * Dùng TRỌN bộ để phá tính chu kỳ của lưới: chỉ khớp dòng P1 thì trượt ±1 dòng
 * cũng cho điểm cao như nhau; thêm P2/P3 (bước và vị trí khác) thì chỉ có một
 * cách khớp đúng.
 */
function gridLines(layout: SheetLayout, width: number, height: number) {
  /**
   * y tính theo CHIỀU CAO ảnh, x theo CHIỀU RỘNG — hai hệ số khác nhau.
   * Trước đây dùng chung `height / layout.height` (= chiều rộng ~1000 khi
   * layout.width = 1) cho cả hai trục → mọi toạ độ y lệch ~30% và profile
   * dọc chỉ phủ 70% ảnh, nên lớp hiệu chỉnh này "sửa" cả phiếu đã khớp
   * (dịch +98px, scale 0.96 trên phiếu chuẩn).
   */
  const H = height;
  const W = width;
  const ys: number[] = [];
  const xs: number[] = [];
  const push = (b: { x: number; y: number }) => {
    ys.push(Math.round(b.y * H));
    xs.push(Math.round(b.x * W));
  };
  for (const q of layout.questions) for (const b of q.bubbles) push(b);
  for (const q of layout.part3) for (const col of q.columns) for (const b of col.bubbles) push(b);
  if (layout.examCode) for (const col of layout.examCode.columns) for (const b of col.bubbles) push(b);
  if (layout.studentCode) for (const col of layout.studentCode.columns) for (const b of col.bubbles) push(b);
  const rows = [...new Set(ys)].sort((a, b) => a - b);
  const cols = [...new Set(xs)].sort((a, b) => a - b);
  return { rows, cols, W, H };
}

/**
 * Đối chiếu profile mực với lưới chuẩn của PHẦN I, tìm (scale, offset) từng trục.
 * Bubble đã tô tạo đỉnh mực tại vị trí THỰC; khớp các dòng/cột chuẩn lên profile
 * sẽ tìm ra độ trượt/dãn — kể cả khi lệch lớn hơn cửa sổ snap.
 */
export function fitGridByProfile(warped: { width: number; height: number; data: Uint8ClampedArray }, layout: SheetLayout): AffineMap | null {
  const ink = inkMap(warped);
  const { rows, cols, W, H } = gridLines(layout, warped.width, warped.height);
  if (rows.length < 10 || cols.length < 6) return null;

  // profile dọc theo y, giới hạn trong dải x của PHẦN I (tránh chữ ở lề)
  const x0 = Math.max(0, cols[0] - 25);
  const x1 = Math.min(W - 1, cols[cols.length - 1] + 25);
  const rowProfile = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (ink.data[y * W + x] !== 0) n++;
    rowProfile[y] = n;
  }
  // profile ngang theo x, trong dải y của PHẦN I
  const y0 = Math.max(0, rows[0] - 25);
  const y1 = Math.min(H - 1, rows[rows.length - 1] + 25);
  const colProfile = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (ink.data[y * W + x] !== 0) n++;
    colProfile[x] = n;
  }

  /**
   * Tìm (s,t) khớp các tâm chuẩn lên profile.
   * Điểm = tổng profile trong cửa sổ ±2px quanh mỗi tâm (chịu được jitter),
   * 2 vòng: thô (s bước 0.005, t bước 2px) rồi tinh (±0.012, ±3px).
   */
  const fit1D = (
    centers: number[],
    profile: Float32Array,
    len: number,
  ): { s: number; t: number; score: number; base: number } | null => {
    const win = (p: number) => {
      let sum = 0;
      for (let d = -2; d <= 2; d++) {
        const q = Math.round(p) + d;
        if (q >= 0 && q < len) sum += profile[q];
      }
      return sum;
    };
    const scoreOf = (s: number, t: number) => {
      let score = 0;
      let ok = 0;
      for (const c of centers) {
        const p = s * c + t;
        if (p < 2 || p >= len - 2) continue;
        score += win(p);
        ok++;
      }
      return ok >= centers.length * 0.9 ? score / ok : -1;
    };
    const base = centers.reduce((acc, c) => acc + (c >= 0 && c < len ? profile[Math.round(c)] : 0), 0) / centers.length;
    let best = { s: 1, t: 0, score: -1 };
    const tMax = Math.round(len * 0.1);
    for (let s = 0.9; s <= 1.12; s += 0.005) {
      for (let t = -tMax; t <= tMax; t += 2) {
        const sc = scoreOf(s, t);
        if (sc > best.score) best = { s, t, score: sc };
      }
    }
    // tinh quanh nghiệm thô
    const cS = best.s;
    const cT = best.t;
    for (let s = cS - 0.012; s <= cS + 0.012; s += 0.0025) {
      for (let t = cT - 3; t <= cT + 3; t += 1) {
        const sc = scoreOf(s, t);
        if (sc > best.score) best = { s, t, score: sc };
      }
    }
    if (best.score < 0) return null;
    return { ...best, base };
  };

  const fy = fit1D(rows, rowProfile, H);
  const fx = fit1D(cols, colProfile, W);
  if (!fy || !fx) return null;

  // Chỉ nhận khi rõ ràng hơn vị trí chuẩn (hoặc vị trí chuẩn gần như không có mực).
  const betterY = fy.score > fy.base * 1.08 || fy.base < 1;
  const betterX = fx.score > fx.base * 1.08 || fx.base < 1;
  if (!betterY && !betterX) return null;

  // scale/offset quá mức → từ chối (tránh fit lỳ).
  if (fy.s < 0.88 || fy.s > 1.14 || Math.abs(fy.t) > H * 0.12) return null;
  if (fx.s < 0.88 || fx.s > 1.14 || Math.abs(fx.t) > W * 0.12) return null;

  const affine = makeAffine(fx.s, 0, fx.t, 0, fy.s, fy.t);
  if (!affine) return null;

  /**
   * Chỉ áp dụng khi lưới lệch ĐÁNG KỂ. Đo trên phiếu render đã khớp hoàn hảo:
   * fit vẫn trả (scale≈1, dịch 3–4px) do nhiễu profile — ngưỡng 3px cũ để lọt
   * ca này và làm xê dịch cả phiếu chuẩn. Lấy 1.2% cạnh ngắn (≈12px với ảnh
   * 1000px) để chỉ nhận khi lệch thật.
   */
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  const shift = Math.max(...corners.map((c) => Math.hypot(affine.apply(c).x - c.x, affine.apply(c).y - c.y)));
  const minShift = Math.max(8, Math.min(W, H) * 0.012);
  if (shift < minShift) return null;

  return affine;
}

/**
 * Fit ánh xạ affine actual ≈ T(expected) từ các cặp lệch lưới (snap).
 * Trả về null khi thiếu dữ liệu, trải quá hẹp, hoặc kết quả phi thực tế
 * (trượt/scale quá mức) — khi đó giữ nguyên warp cũ.
 */
export function fitGridCorrection(
  pairs: GridPair[],
  width: number,
  height: number,
): AffineMap | null {
  if (pairs.length < 8) return null;

  // Cần các cặp phủ rộng trên trang để fit scale/offset đáng tin.
  const ys = pairs.map((p) => p.ey);
  const xs = pairs.map((p) => p.ex);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  if (ySpan < height * 0.4 || xSpan < width * 0.3) return null;

  // actual_x = a1·ex + a2·ey + a3 ; actual_y = b1·ex + b2·ey + b3
  const rows = pairs.map((p) => [p.ex, p.ey, 1]);
  const ax = solve3(rows, pairs.map((p) => p.ax));
  const ay = solve3(rows, pairs.map((p) => p.ay));
  if (!ax || !ay) return null;

  const affine = makeAffine(ax[0], ax[1], ax[2], ay[0], ay[1], ay[2]);
  if (!affine) return null;

  // Chặn khoảng correction phi thực tế.
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const shift = Math.max(...corners.map((c) => Math.hypot(affine.apply(c).x - c.x, affine.apply(c).y - c.y)));
  if (shift < 3) return null;

  // scale hợp lệ
  const sx = Math.hypot(ax[0], ay[0]);
  const sy = Math.hypot(ax[1], ay[1]);
  if (sx < 0.8 || sx > 1.25 || sy < 0.8 || sy > 1.25) return null;
  if (Math.abs(ax[2]) > width * 0.2 || Math.abs(ay[2]) > height * 0.2) return null;

  return affine;
}

/**
 * Độ đậm vành tròn quanh (cx,cy): tỉ lệ điểm mực trên vành bán kính rIn→rOut.
 * Ô in sẵn luôn có vành → dùng làm MỐC định vị lưới; ô tô làm vành đậm hơn.
 */
export function ringDensity(
  ink: { width: number; height: number; data: Uint8ClampedArray },
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

interface ShiftGroup {
  /** Tâm y của nhóm (canonical px). */
  cy: number;
  dx: number;
  dy: number;
}

/**
 * Ước lượng độ lệch lưới theo TỪNG NHÓM lưới (P1 / P2 / từng dải P3 / mã đề /
 * SBD). Giấy cong khi chụp làm offset thay đổi theo chiều dọc — hiệu chỉnh
 * chung cả trang không đủ; vành ô in sẵn là mốc tuyệt đối nên tìm offset của
 * cả NHÓM bằng vành là đáng tin (nhóm ≥ 6 ô, không phụ thuộc ô đã tô).
 *
 * Trả về hàm nội suy tuyến tính theo y giữa tâm các nhóm; null khi không đủ
 * nhóm để ước lượng.
 */
export function estimateSectionShifts(
  warped: { width: number; height: number; data: Uint8ClampedArray },
  layout: SheetLayout,
  ink?: { width: number; height: number; data: Uint8ClampedArray },
): ((x: number, y: number) => { dx: number; dy: number }) | null {
  const inkMapDone = ink ?? inkMap(warped);
  const minSide = Math.min(warped.width, warped.height);

  // Nhóm bubble: mã đề, SBD, P1, P2, từng dải P3 (câu liền kề共用 cùng lưới hàng).
  // Mã đề/SBD có nhóm riêng để NEO nội suy ở vùng trên — nhóm của chúng KHÔNG
  // được áp vào ô chữ số lúc đọc (pipeline giữ examCode/studentCode ở toạ độ
  // gốc; refine từng cột tự xử lý lệch nhỏ) — nếu áp sẽ đọc sai mã đề
  // (418 → 018). Chỉ ước lượng, không áp dụng.
  /**
   * `groups` chỉ chứa NHÓM CÂU. Mã đề / SBD tính riêng rồi BỎ — chúng là lưới
   * nhỏ sát marker góc; nếu dùng làm mốc nội suy thì offset của lưới chữ số
   * (khác hẳn offset lưới câu) sẽ kéo lệch P1 ở vùng trên (trước đây comment
   * ghi "chỉ ước lượng, không áp dụng" nhưng code vẫn đẩy vào `groups` và lọt
   * qua filter độ dài ≥6 → thành anchor thật).
   */
  const groups: { x: number; y: number; r: number }[][] = [];
  /**
   * Ngưỡng gộp nhóm: 1.7× BƯỚC HÀNG trung vị của layout (khoảng cách y giữa các
   * câu liền kề) — giữa các phần có khoảng trống lớn hơn nhiều lần nên tách rõ.
   * ⚠️ Trước đây ngưỡng là "20pt quy đổi" nhưng SAI ĐƠN VỊ: `20/595*minSide` ≈
   * 47.6 trong khi y bubble đã chuẩn hoá (0..1) → mọi câu gộp thành 1–2 nhóm
   * khổng lồ, nội suy theo nhóm mất tác dụng hoàn toàn.
   */
  const ys = layout.questions.map((q) => q.bubbles[0].y).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const g = ys[i] - ys[i - 1];
    if (g > 1e-6) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const rowPitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.015;
  const mergeGap = rowPitch * 1.7;

  // Dò tuần tự theo y tăng dần: câu cách câu trước dưới ngưỡng thì cùng nhóm
  // (dẫn chuỗi nên nhóm dài không bị cắt giữa chừng như so với khoá nhóm đầu).
  const sortedQ = [...layout.questions].sort((a, b) => a.bubbles[0].y - b.bubbles[0].y);
  let cur: { x: number; y: number; r: number }[] | null = null;
  let lastY = -1;
  for (const q of sortedQ) {
    const y = q.bubbles[0].y;
    if (cur && y - lastY < mergeGap) cur.push(...q.bubbles);
    else {
      if (cur) groups.push(cur);
      cur = [...q.bubbles];
    }
    lastY = y;
  }
  if (cur) groups.push(cur);
  for (let i = 0; i < layout.part3.length; i++) {
    const q = layout.part3[i];
    const prev = layout.part3[i - 1];
    if (i > 0 && prev && Math.abs(q.columns[0].bubbles[0].y - prev.columns[0].bubbles[0].y) < mergeGap && groups.length > 0) {
      groups[groups.length - 1].push(...q.columns.flatMap((c) => c.bubbles));
    } else {
      groups.push(q.columns.flatMap((c) => c.bubbles));
    }
  }

  // Bước lưới ≈ 2.5 bán kính ô. Giới hạn dò = NỬA BƯỚC (1.3r): vành ô là tín
  // hiệu TUẦN HOÀN theo pitch — dò rộng hơn nửa bước sẽ khoá vào đỉnh của
  // hàng kề (alias) và đọc lệch cả dải. Trả về null nếu không tìm thấy đỉnh
  // rõ (vùng không có lưới).
  const rPx = (layout.questions[0]?.bubbles[0].r ?? 0.006) * minSide;
  const rad = Math.max(6, Math.round(rPx * 1.3));

  // Chỉ các NHÓM CÂU (P1/P2/P3) tham gia nội suy. Mã đề / SBD: KHÔNG dịch
  // (pipeline giữ nguyên toạ độ của chúng — lưới nhỏ sát marker góc, warp đã
  // chuẩn; dịch theo nội suy dễ làm mất chữ số: 418 → 018). Vùng trên cùng
  // (trên nhóm P1) tự clamp về offset của nhóm P1.
  const shifts: ShiftGroup[] = [];
  for (const g of groups) {
    if (g.length < 6) continue;
    
    // Tối đa 36 ô mỗi nhóm (đều nhau) — đủ tin, nhanh gấp nhiều lần.
    const stride = Math.max(1, Math.ceil(g.length / 36));
    const sample = g.filter((_, i) => i % stride === 0);
    const score = (dx: number, dy: number) => {
      let s = 0;
      for (const b of sample) s += ringDensity(inkMapDone, b.x * warped.width + dx, b.y * warped.height + dy, b.r * minSide);
      return s / sample.length;
    };
    const atZero = score(0, 0);
    if (atZero > 0.85) continue; // vùng mực bão hoà — không có tín hiệu
    let best = { dx: 0, dy: 0, v: atZero };
    for (let dy = -rad; dy <= rad; dy += 2) {
      for (let dx = -rad; dx <= rad; dx += 2) {
        if (dx === 0 && dy === 0) continue;
        if (dx * dx + dy * dy > rad * rad) continue;
        const v = score(dx, dy);
        if (v > best.v) best = { dx, dy, v };
      }
    }
    if (best.v - atZero < 0.04) {
      // Nhóm đã khớp: đẩy anchor (0,0) thay vì bỏ hẳn — nội suy tự về 0 quanh
      // nhóm này, nên một nhóm lệch DUY NHẤT được áp dụng cục bộ thay vì bị
      // bỏ toàn bộ (trước đây `shifts.length < 2` kill hiệu chỉnh khi chỉ có
      // một nhóm cần dịch).
      shifts.push({ cy: (g[0].y + g[g.length - 1].y) / 2 * warped.height, dx: 0, dy: 0 });
      continue;
    }
    shifts.push({ cy: (g[0].y + g[g.length - 1].y) / 2 * warped.height, dx: best.dx, dy: best.dy });
  }

  if (shifts.length < 2) return null;
  shifts.sort((a, b) => a.cy - b.cy);

  return (x: number, y: number) => {
    if (y <= shifts[0].cy) return { dx: shifts[0].dx, dy: shifts[0].dy };
    if (y >= shifts[shifts.length - 1].cy) return { dx: shifts[shifts.length - 1].dx, dy: shifts[shifts.length - 1].dy };
    for (let i = 1; i < shifts.length; i++) {
      if (y <= shifts[i].cy) {
        const t = (y - shifts[i - 1].cy) / (shifts[i].cy - shifts[i - 1].cy);
        return {
          dx: shifts[i - 1].dx + (shifts[i].dx - shifts[i - 1].dx) * t,
          dy: shifts[i - 1].dy + (shifts[i].dy - shifts[i - 1].dy) * t,
        };
      }
    }
    return { dx: 0, dy: 0 };
  };
}

/**
 * Điểm KHỚP LƯỚI của ảnh đã warp: mật độ vành TRUNG BÌNH trên toàn bộ ô in
 * (vành ô luôn được in sẵn nên đo được không phụ thuộc ô đã tô). Dùng làm
 * tiêu chí chấp nhận hiệu chỉnh lưới — lệch lưới thì vành rơi khỏi hộp mẫu,
 * điểm giảm; khớp thì vành nằm đúng tâm, điểm cao.
 */
export function ringAlignmentScore(
  warped: { width: number; height: number; data: Uint8ClampedArray },
  layout: SheetLayout,
  ink?: { width: number; height: number; data: Uint8ClampedArray },
): number {
  const inkDone = ink ?? inkMap(warped);
  const minSide = Math.min(warped.width, warped.height);
  const bubbles = [
    ...layout.questions.flatMap((q) => q.bubbles),
    ...layout.part3.flatMap((q) => q.columns.flatMap((c) => c.bubbles)),
    ...(layout.examCode ? layout.examCode.columns.flatMap((c) => c.bubbles) : []),
    ...(layout.studentCode ? layout.studentCode.columns.flatMap((c) => c.bubbles) : []),
  ];
  if (!bubbles.length) return 0;
  let s = 0;
  for (const b of bubbles) {
    s += ringDensity(inkDone, b.x * warped.width, b.y * warped.height, b.r * minSide);
  }
  return s / bubbles.length;
}

/**
 * NEO NHÃN SỐ CÂU — kiểm tra và sửa lưới PHẦN I bị lệch NGUYÊN MỘT HÀNG.
 *
 * Lưới ô in đều theo pitch: dịch nguyên một hàng vẫn "khớp vành" hoàn toàn,
 * nên mọi lớp hiệu chỉnh theo vành (band-shift, profile fit, snap) đều KHÔNG
 * phân biệt được — đã tái hiện trên phiếu thật: lưới block 2 của PHẦN I bị
 * kéo lên 1 hàng → câu 12 đọc ô của câu 11…, chấm sai cả lo.
 *
 * Mốc PHÂN BIỆT được: nhãn số câu in sẵn bên trái cột A ("11", "12", …) —
 * mỗi nhãn ứng đúng một câu, đếm được theo thứ tự nên không thể trượt hàng.
 * Với từng block P1: dò tâm mực nhãn trong dải x bên trái cột A; nếu ≥70%
 * nhãn lệch cùng chiều ≥0.55 pitch so với hàng của nó → dịch block đúng
 * lượng trung vị.
 *
 * Trả về layout mới (clone đã dịch) hoặc null khi mọi block đã khớp.
 */
export function alignP1BlocksByLabels(
  warped: { width: number; height: number; data: Uint8ClampedArray },
  layout: SheetLayout,
): SheetLayout | null {
  const minSide = Math.min(warped.width, warped.height);
  const qs = layout.questions;
  if (qs.length < 8) return null;
  const p1Count = layout.part1Count ?? Math.min(qs.length, 20);
  if (p1Count < 8) return null;

  // Bước hàng trung vị của P1 (khoảng cách y giữa các câu liền kề).
  const ys = qs.slice(0, p1Count).map((q) => q.bubbles[0].y).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const g = ys[i] - ys[i - 1];
    if (g > 1e-6) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] * warped.height : minSide * 0.02;
  if (!(pitch > 4)) return null;

  // Dải x của nhãn số câu: bên trái cột A (colA − 4×r … colA − 1×r quy đổi —
  // bản in thật đặt nhãn ~5–17px canonical trái cột A, template in ~12–38px).
  const colAX = qs[0].bubbles[0].x * warped.width;
  const bandX0 = Math.max(0, Math.round(colAX - 0.042 * minSide));
  const bandX1 = Math.max(bandX0 + 2, Math.round(colAX - 0.006 * minSide));
  const isInk = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= warped.width || yi >= warped.height) return false;
    // Ngưỡng CỐ ĐỊNH trên ảnh xám thô: nhãn số câu là mực in đậm vừa (~80-160
    // trên nền trắng). inkMap adaptive (cửa sổ 41px) làm DÍNH các nhãn sát nhau
    // (pitch nhãn ~18-30px < cửa sổ) — tâm cụm trôi, không dùng được ở đây.
    return warped.data[yi * warped.width + xi] < 155;
  };

  // Dò TOÀN BỘ nhãn P1 (cửa sổ trải toàn dải y của P1 mở rộng ±1.4 pitch —
  // chấp nhận block bị dịch trọn hàng), CHIA NHÓM NHÃN theo khe giữa nhãn
  // (khe > 1.5×pitch = ranh giới block trên BẢN IN — không phụ thuộc khe của
  // layout, vì layout có thể đang bị dịch trọn hàng làm khe co hẳn).
  const allY0 = Math.max(0, Math.round(ys[0] * warped.height - pitch * 1.4));
  const allY1 = Math.min(warped.height - 1, Math.round(ys[p1Count - 1] * warped.height + pitch * 1.4));
  const bandCols: number[] = [];
  for (let x = bandX0; x <= bandX1; x++) {
    let c = 0;
    for (let y = allY0; y <= allY1; y++) if (isInk(x, y)) c++;
    if (c < (allY1 - allY0 + 1) * 0.7) bandCols.push(x);
  }
  if (bandCols.length < 3) return null;
  const inkRows: { y: number; s: number; m: number }[] = [];
  for (let y = allY0; y <= allY1; y++) {
    let c = 0, sx = 0;
    for (const x of bandCols) {
      if (isInk(x, y)) {
        c++;
        sx += x;
      }
    }
    if (c > 0) inkRows.push({ y, s: sx, m: c });
  }
  const blobs: { y: number; m: number; h: number }[] = [];
  let acc: { s: number; m: number; prev: number; top: number } | null = null;
  for (const r of inkRows) {
    if (!acc || r.y - acc.prev > Math.max(2.5, pitch * 0.25)) {
      if (acc && acc.m > 0) blobs.push({ y: acc.s / acc.m, m: acc.m, h: acc.prev - acc.top + 1 });
      acc = { s: 0, m: 0, prev: r.y, top: r.y };
    }
    acc.s += r.y * r.m;
    acc.m += r.m;
    acc.prev = r.y;
  }
  if (acc && acc.m > 0) blobs.push({ y: acc.s / acc.m, m: acc.m, h: acc.prev - acc.top + 1 });
  if (blobs.length < 4) return null;

  /**
   * Lọc blob KHÔNG PHẢI nhãn số câu. Nhãn số là chữ số in thấp (cao ~0.3–0.8
   * bước hàng, khối lượng mực vừa phải); tiêu đề "PHẦN I", đường kẻ ngang, chữ
   * trong khung cao/dày hơn hẳn. Lọc cả CHIỀU CAO lẫn khối lượng, ngưỡng lấy
   * theo bước hàng nên không phụ thuộc độ phân giải. Sau đó CỔNG TOÀN CỤC:
   * phải đủ ~số câu P1 nhãn và bước nhãn khớp bước hàng layout — thiếu một
   * trong hai thì ảnh không có nhãn (hoặc nhãn không đọc được) → bỏ, không
   * được đoán (đoán sai còn tệ hơn không sửa).
   */
  const massMed = [...blobs.map((b) => b.m)].sort((a, b) => a - b)[Math.floor(blobs.length / 2)];
  const blobList = blobs.filter(
    (b) =>
      b.h >= pitch * 0.2 &&
      b.h <= pitch * 0.85 &&
      b.m >= Math.max(4, massMed * 0.25) &&
      b.m <= Math.max(8, massMed * 3),
  );
  const blobYs = blobList.map((b) => b.y);

  /**
   * CỔNG BẰNG CHỨNG: nhãn số câu in ĐỀU một nhãn mỗi hàng, nên số blob phải ≈
   * số câu P1 (chênh ≤ 20%). Ảnh không có nhãn (bản render/nhiều thể loại in
   * khác) sẽ có số blob lệch xa hoặc rơi vào nhiễu rời rạc → bỏ, KHÔNG đoán:
   * sửa nhầm một block đang đúng còn tệ hơn không sửa (mất cả lo điểm).
   */
  if (Math.abs(blobYs.length - p1Count) > Math.round(p1Count * 0.2)) return null;

  /**
   * Nhãn phải CÁCH ĐỀU theo bước hàng: đo khoảng cách giữa các nhãn liền kề
   * (trong cùng block) — nhiễu rời rạc cho khoảng cách loạn, nhãn thật đều.
   * Dùng trung vị + đếm số khoảng cách khớp pitch (≥70%) thay vì MAD của
   * (nhãn − hàng) vì block có thể bị dịch TRỌN một hàng (dys lệch đều nhưng
   * vẫn hợp lệ).
   */
  const gapsB: number[] = [];
  for (let i = 1; i < blobYs.length; i++) {
    const g = blobYs[i] - blobYs[i - 1];
    if (g < pitch * 2) gapsB.push(g); // bỏ qua khe giữa block
  }
  if (gapsB.length < 4) return null;
  const gapMatched = gapsB.filter((g) => Math.abs(g - pitch) < pitch * 0.3).length;
  if (gapMatched < gapsB.length * 0.7) return null;

  /**
   * GHÉP NHÃN ↔ CÂU THEO BƯỚC HÀNG CỦA LAYOUT — không dựa vào khe/nhóm nào
   * của ảnh. Mỗi nhãn được gán về câu gần nhất trên trục y (sai số ≤ 0.5
   * pitch). Chỉ những câu có nhãn (đa số) mới dùng để tính dịch, và chỉ khi
   * SỐ NHÃN đủ gần số câu P1 — ảnh không có nhãn số câu (hoặc nhãn đọc lẫn
   * nhiễu) thì bỏ, tuyệt đối không đoán.
   */
  if (blobYs.length < p1Count * 0.7 || blobYs.length > p1Count * 1.4) return null;
  const rowYsAll = qs.slice(0, p1Count).map((q) => q.bubbles[0].y * warped.height);

  /**
   * Ghép CHUỖI NHÃN ↔ CHUỖI CÂU bằng cách dò độ lệch TOÀN CỤC d: với mỗi giá
   * trị d ứng viên (mỗi nhãn trừ mỗi câu), đếm số cặp (nhãn, câu) khớp trong
   * sai số 0.35 pitch khi nhãn thứ i ứng câu thứ i. Dịch nguyên một hàng (d ≈
   * ±1 pitch) vẫn được tính đúng vì phép ghép theo THỨ TỰ, không theo "gần
   * nhất" (gần nhất sẽ gán nhầm nhãn "11" cho câu 10 khi block bị kéo lên).
   */
  const votes = new Map<number, number[]>();
  const nCommon = Math.min(blobYs.length, rowYsAll.length);
  for (let i = 0; i < nCommon; i++) {
    // nhãn thứ i ↔ câu thứ i (cả hai đều xếp theo y tăng dần)
    const arr = votes.get(i) ?? [];
    arr.push(blobYs[i] - rowYsAll[i]);
    votes.set(i, arr);
  }
  if (votes.size < p1Count * 0.6) return null;

  /**
   * DỊCH THEO TỪNG ĐOẠN (block): gom các câu liền kề có dịch GIỐNG NHAU
   * (chênh < 0.35 pitch) thành một đoạn và áp cùng một dịch. Nhờ vậy một block
   * bị dịch trọn hàng được sửa riêng, các block đúng không bị đụng.
   */
  const perRow: ({ dy: number } | null)[] = [];
  for (let k = 0; k < p1Count; k++) {
    const ds = votes.get(k);
    if (!ds || !ds.length) {
      perRow.push(null);
      continue;
    }
    ds.sort((a, b) => a - b);
    perRow.push({ dy: ds[Math.floor(ds.length / 2)] });
  }

  let moved = false;
  const newQs = qs.map((q) => ({ ...q, bubbles: q.bubbles.map((b) => ({ ...b })) }));

  // Gom đoạn: câu liền kề có dy giống nhau (chênh < 0.35 pitch).
  const segs: { rows: number[]; dy: number }[] = [];
  for (let k = 0; k < p1Count; k++) {
    const cur = perRow[k];
    if (!cur) continue;
    const last = segs[segs.length - 1];
    if (last && last.rows[last.rows.length - 1] === k - 1 && Math.abs(last.dy - cur.dy) < pitch * 0.35) {
      last.rows.push(k);
    } else {
      segs.push({ rows: [k], dy: cur.dy });
    }
  }
  for (const seg of segs) {
    // đoạn phải đủ dài mới tin (nhãn đơn lẻ có thể là nhiễu)
    if (seg.rows.length < 4) continue;
    // chỉ can thiệp khi lệch ≥ 0.55 pitch (dịch hàng thật, không phải nhiễu)
    if (Math.abs(seg.dy) < pitch * 0.55 || Math.abs(seg.dy) > pitch * 1.8) continue;
    for (const k of seg.rows) {
      for (const b of newQs[k].bubbles) b.y += seg.dy / warped.height;
    }
    moved = true;
  }
  return moved ? { ...layout, questions: newQs } : null;
}
