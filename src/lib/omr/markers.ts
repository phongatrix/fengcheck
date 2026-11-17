/**
 * Corner-marker detection, two-stage:
 *
 *  1. Paper detection — the bright sheet is the largest bright connected
 *     component; its extremal corners give the paper quad (robust against
 *     handwriting, stamps, dense print).
 *  2. Marker location — each corner marker sits at a fixed page fraction
 *     (from the layout), so map that fraction through the paper quad and
 *     search a small window for the dark marker blob. A missed marker falls
 *     back to its expected position.
 *
 * Falls back to the classic "4 biggest square blobs" search when no paper
 * quad can be found. Works for the printed Giấy templates (small markers on
 * dense sheets) as well as the custom layout.
 */

import type { GrayMat, Pt } from "./types";
import {
  adaptiveThresholdInv,
  countNonZero,
  laplacianVariance,
  resizeMat,
  thresholdBright,
} from "./matrix";
import { orderQuad, polygonArea } from "./geometry";

export interface Blob {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  fill: number;
  cx: number;
  cy: number;
}

/** Connected components (8-connected) on a binary mat. Foreground = 255. */
export function connectedComponents(mat: GrayMat, minArea = 12): Blob[] {
  const { width, height, data } = mat;
  const labels = new Int32Array(width * height).fill(-1);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0 || labels[i] !== -1) continue;
    const id = blobs.length;
    stack.length = 0;
    stack.push(i);
    labels[i] = id;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let count = 0;

    while (stack.length) {
      const p = stack.pop()!;
      const y = (p / width) | 0;
      const x = p - y * width;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (data[q] !== 0 && labels[q] === -1) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }

    if (count < minArea) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    blobs.push({
      x: minX,
      y: minY,
      w,
      h,
      area: count,
      fill: count / (w * h),
      cx: minX + w / 2,
      cy: minY + h / 2,
    });
  }
  return blobs;
}

export interface MarkerDetectResult {
  ok: boolean;
  quad: [Pt, Pt, Pt, Pt] | null;
  /** True when `quad` is the paper edge, not the marker positions. */
  quadIsPaper?: boolean;
  /** True khi khung marker có góc DỰ ĐOÁN affine (marker thật bị mất) — cần
   *  hiệu chỉnh lưới sau warp. */
  quadApprox?: boolean;
  markers: Blob[];
  candidates: number;
  sharpness: number;
  message?: string;
}

export interface MarkerDetectOptions {
  minSharpness?: number;
  checkSharpness?: boolean;
  /** Page fractions of the 4 corner markers (TL,TR,BR,BL) for stage 2. */
  markerFractions?: [MarkerAnchor, MarkerAnchor, MarkerAnchor, MarkerAnchor];
  /** Tỉ lệ trang in (width/height) — để kiểm tra hình học khung marker. */
  pageAspect?: number;
}

/** Corner marker anchor: page fraction + radius in min-side units. */
export interface MarkerAnchor {
  x: number;
  y: number;
  /** Radius in min-side units (drives the expected blob area). */
  r: number;
}

export function detectCornerMarkers(gray: GrayMat, opts: MarkerDetectOptions = {}): MarkerDetectResult {
  const sharpness = laplacianVariance(gray);
  const { checkSharpness = true, minSharpness = 90 } = opts;

  if (checkSharpness && sharpness < minSharpness) {
    return {
      ok: false,
      quad: null,
      markers: [],
      candidates: 0,
      sharpness,
      message: "Ảnh mờ — giữ máy chắc và lấy nét lại",
    };
  }

  // Stage 1 + 2: paper quad, then local marker search.
  if (opts.markerFractions) {
    const paper = detectPaperQuad(gray);
    // Phiếu tràn kín khung (chụp cận) làm "mép giấy" = mép ảnh → mọi page
    // fraction đều sai. Trường hợp đó tìm marker trực tiếp trước.
    const paperFillsFrame = paper ? polygonArea(paper) / (gray.width * gray.height) > 0.965 : false;
    if (paper && !paperFillsFrame) {
      const quad = locateMarkers(gray, paper, opts.markerFractions, opts.pageAspect);
      if (quad) {
        return { ok: true, quad, quadIsPaper: false, markers: [], candidates: 4, sharpness };
      }
      // Mép giấy thấy được nhưng marker không xác nhận (ảnh cắt mất góc, bóng
      // đổ): marker in sẵn vẫn là mốc chính xác nhất — thử tìm chúng trực tiếp
      // trước khi lùi về mép giấy. Warp theo mép giấy bị cắt sẽ lệch cả lưới,
      // chết riêng ô số nhỏ của SBD/Mã đề.
      const global = detectMarkerQuadGlobally(gray, opts.markerFractions, opts.pageAspect);
      if (global)
        return { ok: true, quad: global.quad, quadApprox: global.approx, quadIsPaper: false, markers: [], candidates: 4, sharpness };
      // Markers not confirmable (cropped corners, heavy occlusion): report the
      // paper quad — the caller warps it onto the FULL page, where every
      // feature sits at its page fraction, and the bubble snap recovers
      // local offsets.
      return { ok: true, quad: paper, quadIsPaper: true, markers: [], candidates: 4, sharpness };
    }
    const global = detectMarkerQuadGlobally(gray, opts.markerFractions, opts.pageAspect);
    if (global)
      return { ok: true, quad: global.quad, quadApprox: global.approx, quadIsPaper: false, markers: [], candidates: 4, sharpness };
    if (paper) {
      return { ok: true, quad: paper, quadIsPaper: true, markers: [], candidates: 4, sharpness };
    }
  }

  // Fallback: classic square-blob search (custom sheets, no fractions given).
  return detectByBlobs(gray, sharpness);
}

/**
 * Tìm 4 marker in sẵn mà KHÔNG cần mép giấy.
 *
 * Trên phiếu QM 2025, marker góc (13.4pt) và các vạch thước cạnh (7.6pt) đều là
 * ô đen đặc. 4 marker góc luôn là 4 điểm CỰC TRỊ của tập ô đen (trên/dưới/
 * trái/phải), nên chỉ cần lấy bao theo bốn hướng — vạch thước nằm trong, không
 * chen được. Dùng khi ảnh chụp cắt mất mép giấy hoặc nền sáng làm detectPaperQuad
 * trả về cả khung hình.
 */
function detectMarkerQuadGlobally(
  gray: GrayMat,
  fractions: [MarkerAnchor, MarkerAnchor, MarkerAnchor, MarkerAnchor],
  pageAspect?: number,
): { quad: [Pt, Pt, Pt, Pt]; approx: boolean } | null {
  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(gray.width, gray.height));
  const work =
    scale < 1 ? resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale)) : gray;
  const minSide = Math.min(work.width, work.height);

  const mask = new Uint8ClampedArray(work.width * work.height);
  for (let i = 0; i < mask.length; i++) mask[i] = work.data[i] < 110 ? 255 : 0;
  const blobs = connectedComponents({ width: work.width, height: work.height, data: mask }, 24);

  const expectSide = 2 * fractions[0].r * minSide;
  const squares = blobs.filter((b) => {
    const aspect = b.w / b.h;
    const side = (b.w + b.h) / 2;
    return aspect > 0.6 && aspect < 1.7 && b.fill > 0.7 && side > expectSide * 0.45 && side < expectSide * 2.2;
  });
  if (squares.length < 4) return null;

  let tl = squares[0], br = squares[0], tr = squares[0], bl = squares[0];
  let sMin = Infinity, dMax = -Infinity, sMax = -Infinity, dMin = Infinity;
  for (const b of squares) {
    const s = b.cx + b.cy;
    const d = b.cx - b.cy;
    if (s < sMin) { sMin = s; tl = b; }
    if (s > sMax) { sMax = s; br = b; }
    if (d > dMax) { dMax = d; tr = b; }
    if (d < dMin) { dMin = d; bl = b; }
  }
  if (new Set([tl, tr, br, bl]).size < 4) return null;

  /**
   * Tỉ lệ khung marker chuẩn (wTop/hLeft theo layout) — dùng để tự hoàn thiện
   * khung khi một marker góc bị MẤT (nằm ngoài khung ảnh, chìm trong bóng).
   * Quy luật cực trị khi đó chọn nhầm một ô đen trong thân phiếu làm marker:
   * dự đoán affine từ 3 marker thật (góc = kề1 + kề2 − đối diện) chỉ đúng vị
   * trí còn thiếu. Chọn phương án sửa cho tỉ lệ khung sát chuẩn nhất.
   */
  const target =
    pageAspect && pageAspect > 0
      ? ((fractions[1].x - fractions[0].x) * pageAspect) / (fractions[3].y - fractions[0].y)
      : null;
  const aspectErr = (q: [Pt, Pt, Pt, Pt]): number | null => {
    if (!isConvex(q)) return null;
    const wT = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const wB = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
    const hL = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const hR = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
    if (hL <= 0 || wT <= 0) return null;
    // Khung marker là HÌNH CHỮ NHẬT nhìn nghiêng: cạnh trên ≈ cạnh dưới, cạnh
    // trái ≈ cạnh phải (perspective nhẹ cho lệch ít). Ô đen trong thân phiếu
    // làm góc "br" thì hai cạnh này lệch nhau hàng chục phần trăm.
    let err = Math.max(Math.abs(Math.log(wT / wB)), Math.abs(Math.log(hL / hR)));
    if (target) err = Math.max(err, Math.abs(Math.log(wT / hL / target)));
    return err;
  };

  const pts: [Pt, Pt, Pt, Pt] = [
    { x: tl.cx / scale, y: tl.cy / scale },
    { x: tr.cx / scale, y: tr.cy / scale },
    { x: br.cx / scale, y: br.cy / scale },
    { x: bl.cx / scale, y: bl.cy / scale },
  ];
  // [kề1, kề2, đối diện] cho từng góc: góc = kề1 + kề2 − đối diện (affine).
  const ADJ: [number, number, number][] = [
    [1, 3, 2], // tl
    [0, 2, 3], // tr
    [1, 3, 0], // br
    [0, 2, 1], // bl
  ];
  const tolFix = 0.08 * minSide; // lệch xa dự đoán mới coi là marker sai
  const tolSnap = 0.05 * minSide; // ô vuông gần dự đoán thì dùng ô đó
  let quadApprox = false;
  for (let pass = 0; pass < 2; pass++) {
    const err0 = aspectErr(pts);
    if (err0 === null || err0 < 0.09) break; // khung đã chuẩn
    let bestErr = err0;
    let bestVariant: [Pt, Pt, Pt, Pt] | null = null;
    let bestApprox = false;
    for (let i = 0; i < 4; i++) {
      const [a, b, opp] = ADJ[i];
      const pred = {
        x: pts[a].x + pts[b].x - pts[opp].x,
        y: pts[a].y + pts[b].y - pts[opp].y,
      };
      if (Math.hypot(pts[i].x - pred.x, pts[i].y - pred.y) < tolFix) continue;
      // ô vuông ứng viên gần vị trí dự đoán thì dùng (chính xác hơn dự đoán suông)
      let cand: Pt = pred;
      let dist = tolSnap;
      for (const s of squares) {
        const d = Math.hypot(s.cx / scale - pred.x, s.cy / scale - pred.y);
        if (d < dist) {
          dist = d;
          cand = { x: s.cx / scale, y: s.cy / scale };
        }
      }
      const variant = [...pts] as [Pt, Pt, Pt, Pt];
      variant[i] = cand;
      const err = aspectErr(variant);
      if (err !== null && err < bestErr * 0.7) {
        bestErr = err;
        bestVariant = variant;
        bestApprox = cand === pred;
      }
    }
    if (!bestVariant) break;
    pts.splice(0, 4, ...bestVariant);
    quadApprox = bestApprox;
  }

  const quad = orderQuad(pts);
  if (!quad || !isConvex(quad)) return null;

  const wTop = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const hLeft = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  if (hLeft <= 0) return null;
  // Khung marker rộng (x_tr−x_tl)·pageW, cao (y_bl−y_tl)·pageH — cần pageAspect
  // để so đúng đơn vị; không có thì bỏ qua kiểm tra tỉ lệ.
  if (target) {
    if (Math.abs(Math.log(wTop / hLeft / target)) > 0.3) return null; // ±35%
  }
  const coverage = polygonArea(quad) / (gray.width * gray.height);
  if (coverage < 0.12 || coverage > 0.98) return null;

  return { quad, approx: quadApprox };
}

/** Bilinear point on the paper quad (TL,TR,BR,BL). */
function quadPoint(quad: [Pt, Pt, Pt, Pt], fx: number, fy: number): Pt {
  const topX = quad[0].x + (quad[1].x - quad[0].x) * fx;
  const topY = quad[0].y + (quad[1].y - quad[0].y) * fx;
  const botX = quad[3].x + (quad[2].x - quad[3].x) * fx;
  const botY = quad[3].y + (quad[2].y - quad[3].y) * fx;
  return { x: topX + (botX - topX) * fy, y: topY + (botY - topY) * fy };
}

/** Find the bright paper sheet and return its 4 extremal corners. */
export function detectPaperQuad(gray: GrayMat): [Pt, Pt, Pt, Pt] | null {
  const maxSide = 520;
  const scale = Math.min(1, maxSide / Math.max(gray.width, gray.height));
  const work =
    scale < 1
      ? resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale))
      : gray;

  const minArea = Math.round(work.width * work.height * 0.1);
  let t = otsuClamped(work, 140, 205);
  let bright = thresholdBright(work, t);
  let blobs = connectedComponents(bright, minArea);
  // Heavy shadows can split the sheet — relax the threshold if needed.
  if (blobs.length === 0) {
    t = otsuClamped(work, 120, 190);
    bright = thresholdBright(work, t);
    blobs = connectedComponents(bright, minArea);
  }
  if (blobs.length === 0) return null;

  // Largest bright component = the paper.
  const paper = blobs.reduce((a, b) => (b.area > a.area ? b : a));
  if (paper.area < work.width * work.height * 0.15) return null;

  // Extremal corners of the component.
  let tl = { x: paper.x, y: paper.y };
  let tr = tl;
  let br = tl;
  let bl = tl;
  let bestTl = Infinity;
  let bestTr = -Infinity;
  let bestBr = -Infinity;
  let bestBl = Infinity;
  const x0 = Math.max(0, paper.x);
  const y0 = Math.max(0, paper.y);
  const x1 = Math.min(work.width, paper.x + paper.w);
  const y1 = Math.min(work.height, paper.y + paper.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (bright.data[y * work.width + x] === 0) continue;
      const s = x + y;
      const d = x - y;
      if (s < bestTl) { bestTl = s; tl = { x, y }; }
      if (d > bestTr) { bestTr = d; tr = { x, y }; }
      if (s > bestBr) { bestBr = s; br = { x, y }; }
      if (d < bestBl) { bestBl = d; bl = { x, y }; }
    }
  }
  const inv = 1 / scale;
  return [
    { x: tl.x * inv, y: tl.y * inv },
    { x: tr.x * inv, y: tr.y * inv },
    { x: br.x * inv, y: br.y * inv },
    { x: bl.x * inv, y: bl.y * inv },
  ];
}

function otsuClamped(mat: GrayMat, lo: number, hi: number): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < mat.data.length; i++) hist[mat.data[i]]++;
  const total = mat.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let best = (lo + hi) / 2;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      best = t;
    }
  }
  return Math.min(hi, Math.max(lo, best));
}

/** Locate the 4 markers around their expected positions; 3/4 must confirm. */
function locateMarkers(
  gray: GrayMat,
  paper: [Pt, Pt, Pt, Pt],
  fractions: [MarkerAnchor, MarkerAnchor, MarkerAnchor, MarkerAnchor],
  pageAspect?: number,
): [Pt, Pt, Pt, Pt] | null {
  const minSide = Math.min(gray.width, gray.height);
  const markerAreaOf = (f: MarkerAnchor) => Math.pow(2 * f.r * minSide, 2);
  const locate = (winR: number): { pts: Pt[]; confirmed: number } => {
    const pts: Pt[] = [];
    let confirmed = 0;
    for (const f of fractions) {
      const expected = quadPoint(paper, f.x, f.y);
      const hit = findMarkerBlob(gray, expected, winR, markerAreaOf(f));
      if (hit) {
        pts.push(hit);
        confirmed++;
      } else {
        pts.push(expected);
      }
    }
    return { pts, confirmed };
  };

  // Phone perspective can push a corner marker several percent off its paper
  // fraction — start tight, widen once, then accept the best attempt.
  const tight = locate(Math.max(10, Math.round(minSide * 0.022)));
  let result = tight;
  if (tight.confirmed < 4) {
    const wide = locate(Math.max(14, Math.round(minSide * 0.05)));
    if (wide.confirmed > tight.confirmed) result = wide;
  }
  if (result.confirmed < 3) return null;
  const quad = orderQuad(result.pts);
  if (!quad || !isConvex(quad)) return null;
  // Khung marker phải đúng HÌNH DẠNG: cạnh đối xứng nhau (hình chữ nhật nhìn
  // nghiêng) và tỉ lệ rộng/cao khớp layout. Mép giấy dò sai (bóng tối cắt
  // ngang tờ giấy) khiến khung lệch cả hai tiêu chí và các "marker xác nhận"
  // thực ra là ô đen ĐỘT QUYỀN trong thân phiếu — chặn ở đây để rơi xuống dò
  // marker toàn ảnh (chính xác hơn) thay vì warp cả trang theo khung sai.
  const target =
    pageAspect && pageAspect > 0
      ? ((fractions[1].x - fractions[0].x) * pageAspect) / (fractions[3].y - fractions[0].y)
      : null;
  const wT = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const wB = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const hL = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const hR = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  if (wT <= 0 || hL <= 0) return null;
  let err = Math.max(Math.abs(Math.log(wT / wB)), Math.abs(Math.log(hL / hR)));
  if (target) err = Math.max(err, Math.abs(Math.log(wT / hL / target)));
  if (err > 0.3) return null; // ±35%
  return quad;
}

/**
 * The corner marker is the largest solid dark blob inside the search window.
 * Using the blob (not the raw ink centroid) keeps nearby printed text —
 * headers, grid labels — from dragging the point off the marker.
 */
function findMarkerBlob(gray: GrayMat, center: Pt, winR: number, expectedArea: number): Pt | null {
  const x0 = Math.max(0, Math.round(center.x - winR));
  const y0 = Math.max(0, Math.round(center.y - winR));
  const x1 = Math.min(gray.width, Math.round(center.x + winR));
  const y1 = Math.min(gray.height, Math.round(center.y + winR));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return null;

  // Crop the window into a small dark mask, then take the solid blob nearest
  // the expected marker position (NOT the biggest — the window can reach past
  // the paper edge into dark background).
  const mask = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      mask[y * w + x] = gray.data[(y0 + y) * gray.width + (x0 + x)] < 110 ? 255 : 0;
    }
  }
  const blobs = connectedComponents({ width: w, height: h, data: mask }, 16);
  let best: Blob | null = null;
  let bestDist = Infinity;
  for (const b of blobs) {
    if (b.area < expectedArea * 0.25) continue;
    const d = Math.hypot(b.cx - (center.x - x0), b.cy - (center.y - y0));
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  if (!best) return null;
  return { x: x0 + best.cx, y: y0 + best.cy };
}

/** Classic fallback: pick the best convex quad from the largest square blobs. */
function detectByBlobs(gray: GrayMat, sharpness: number): MarkerDetectResult {
  // Work at a bounded resolution so repeated webcam frames stay cheap.
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(gray.width, gray.height));
  const work =
    scale < 1
      ? resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale))
      : gray;

  const bin = adaptiveThresholdInv(work, 31, 12);
  const blobs = connectedComponents(bin, 24);

  const minSide = Math.max(8, Math.round(Math.min(work.width, work.height) * 0.014));
  const maxSidePx = Math.min(work.width, work.height) * 0.28;

  const square = blobs.filter((b) => {
    const aspect = b.w / b.h;
    const side = (b.w + b.h) / 2;
    return (
      aspect > 0.62 &&
      aspect < 1.6 &&
      b.fill > 0.45 &&
      side >= minSide &&
      side <= maxSidePx &&
      b.w >= 6 &&
      b.h >= 6
    );
  });

  if (square.length < 4) {
    return {
      ok: false,
      quad: null,
      markers: square.slice(0, 4),
      candidates: square.length,
      sharpness,
      message: "Chưa thấy đủ 4 góc — đưa phiếu vào khung hình",
    };
  }

  square.sort((a, b) => b.area - a.area);
  const pool = square.slice(0, 14);

  let best: { quad: [Pt, Pt, Pt, Pt]; score: number } | null = null;
  const n = pool.length;
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          const pts: Pt[] = [pool[a], pool[b], pool[c], pool[d]].map((v) => ({ x: v.cx, y: v.cy }));
          const quad = orderQuad(pts);
          if (!quad) continue;

          const area = polygonArea(quad);
          const imgArea = work.width * work.height;
          const coverage = area / imgArea;
          if (coverage < 0.08 || coverage > 0.96) continue;

          if (!isConvex(quad)) continue;

          const sides = [
            Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y),
            Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y),
            Math.hypot(quad[3].x - quad[2].x, quad[3].y - quad[2].y),
            Math.hypot(quad[0].x - quad[3].x, quad[0].y - quad[3].y),
          ];
          const minS = Math.min(...sides);
          const maxS = Math.max(...sides);
          const balance = minS / maxS;

          const wTop = (sides[0] + sides[2]) / 2;
          const hSide = (sides[1] + sides[3]) / 2;
          const aspect = wTop / hSide;
          const target = aspect >= 1 ? 1.75 : 1 / 1.75;
          const aspectPenalty = Math.abs(Math.log(aspect / target));

          const score = coverage * balance - aspectPenalty * 0.35;
          if (!best || score > best.score) {
            best = { quad, score };
          }
        }
      }
    }
  }

  if (!best) {
    return {
      ok: false,
      quad: null,
      markers: square.slice(0, 4),
      candidates: square.length,
      sharpness,
      message: "4 góc không tạo thành khung phiếu hợp lệ",
    };
  }

  const inv = 1 / scale;
  const quad = best.quad.map((p) => ({ x: p.x * inv, y: p.y * inv })) as [Pt, Pt, Pt, Pt];

  return { ok: true, quad, markers: square.slice(0, 4), candidates: square.length, sharpness };
}

function isConvex(q: [Pt, Pt, Pt, Pt]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = q[i];
    const p2 = q[(i + 1) % 4];
    const p3 = q[(i + 2) % 4];
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Count dark pixels inside a circle (used by bubble/digit readers). */
export function circleDarkRatio(mat: GrayMat, cx: number, cy: number, r: number): number {
  const rect = { x: Math.round(cx - r), y: Math.round(cy - r), w: Math.max(1, Math.round(2 * r)), h: Math.max(1, Math.round(2 * r)) };
  const total = Math.PI * r * r;
  if (total <= 0) return 0;
  return Math.min(1, countNonZero(mat, rect) / total);
}
