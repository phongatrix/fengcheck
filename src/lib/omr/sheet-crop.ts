/**
 * CẮT ẢNH UPLOAD THEO KHUNG ĐỎ CỦA MẪU + XOAY THẲNG.
 *
 * Vấn đề: ảnh chụp/tải lên thường có nền bàn, mép giấy xiên, phiếu nằm lệch
 * trong khung hình. Chấm trực tiếp trên ảnh đó khiến lưới đáp án phải bù sai
 * lệch lớn và preview lẫn nền.
 *
 * Cách làm (dựa đúng các mốc in trên phiếu, không cần OpenCV):
 *  1. Tìm 4 MỐC VUÔNG ĐEN ở 4 góc vùng đáp án (blob vuông đặc ~1.2–2.6% bề
 *     ngang ảnh) — đây là mốc tuyệt đối duy nhất có trên mọi bản in.
 *  2. Từ 4 mốc + vị trí của chúng trong layout → homography canonical → ảnh.
 *  3. Chiếu KHUNG ĐỎ (`layout.cropBox`, đo từ ảnh tiêu chí của mẫu) qua
 *     homography đó → 4 góc khung trong ảnh chụp → warp + cắt.
 *  ⇒ Ảnh ra = đúng vùng khung đỏ, đã xoay thẳng theo 2 trục mốc (xử lý cả
 *     nghiêng lẫn phối cảnh, không cần ước lượng góc riêng).
 *
 * Khi KHÔNG tìm đủ 4 mốc: thoái lui về `estimateSkew` — ước lượng góc nghiêng
 * từ profile chiếu của mực (đường kẻ ngang in sẵn dày và dài nhất trên phiếu),
 * xoay ảnh thẳng rồi cắt theo tỉ lệ khung đỏ của mẫu.
 */

import type { GrayMat, Pt, SheetLayout } from "./types";
import { quadPointMapper, resizeMat, warpQuadToMat } from "./matrix";

export interface CropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CropPlan {
  /** 4 góc khung đỏ trong ảnh gốc (TL, TR, BR, BL). */
  quad: [Pt, Pt, Pt, Pt];
  /** Kích thước ảnh ra (giữ đúng tỉ lệ khung). */
  outW: number;
  outH: number;
  /** Có đủ 4 mốc (true) hay chỉ ước lượng bằng góc nghiêng (false). */
  byMarkers: boolean;
  /** Góc nghiêng ước lượng (độ) — chỉ có nghĩa khi byMarkers = false. */
  skewDeg?: number;
}

/** Kích thước khung đỏ theo px canonical (layout.width = 1 nên x là tỉ lệ bề rộng). */
export function cropBoxPx(box: CropBox, layout: SheetLayout, w: number, h: number) {
  return {
    x0: box.x0 * w,
    y0: box.y0 * layout.height * h,
    x1: box.x1 * w,
    y1: box.y1 * layout.height * h,
  };
}

/**
 * Layout ĐÃ CẮT: mọi toạ độ quy về khung đỏ. Dùng để đọc ảnh đã cắt bằng đúng
 * bộ đọc hiện tại (không phải viết lại reader).
 *
 *  x' = (x - x0) / (x1 - x0)
 *  y' = (y - y0) / (y1 - y0)
 *  height' = height · (y1 - y0) / (x1 - x0)
 */
export function rescaleLayout(layout: SheetLayout, box: CropBox): SheetLayout {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (!(bw > 0.05) || !(bh > 0.05)) return layout;
  const fx = (x: number) => (x - box.x0) / bw;
  const fy = (y: number) => (y - box.y0) / bh;
  const sc = (v: number) => v / bw; // bán kính co theo trục x (gần đúng, 2 trục ~ bằng nhau)
  const mapBubble = <T extends { x: number; y: number; r: number }>(b: T): T => ({
    ...b,
    x: fx(b.x),
    y: fy(b.y),
    r: sc(b.r),
  });
  return {
    ...layout,
    height: (layout.height * bh) / bw,
    markers: {
      tl: mapBubble(layout.markers.tl),
      tr: mapBubble(layout.markers.tr),
      br: mapBubble(layout.markers.br),
      bl: mapBubble(layout.markers.bl),
    },
    questions: layout.questions.map((q) => ({
      ...q,
      bubbles: q.bubbles.map(mapBubble),
    })),
    part3: layout.part3.map((p) => ({
      ...p,
      columns: p.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(mapBubble) })),
      signs: p.signs
        ? {
            neg: mapBubble(p.signs.neg),
            comma1: mapBubble(p.signs.comma1),
            comma2: mapBubble(p.signs.comma2),
          }
        : p.signs,
    })),
    examCode: layout.examCode
      ? {
          ...layout.examCode,
          columns: layout.examCode.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(mapBubble) })),
          label: {
            ...layout.examCode.label,
            x: fx(layout.examCode.label.x),
            y: fy(layout.examCode.label.y),
            w: sc(layout.examCode.label.w),
            h: (layout.examCode.label.h * layout.height) / layout.height / bw,
          },
        }
      : null,
    studentCode: layout.studentCode
      ? {
          ...layout.studentCode,
          columns: layout.studentCode.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(mapBubble) })),
          label: {
            ...layout.studentCode.label,
            x: fx(layout.studentCode.label.x),
            y: fy(layout.studentCode.label.y),
            w: sc(layout.studentCode.label.w),
            h: layout.studentCode.label.h / bw,
          },
        }
      : null,
    scoreAnchor: { x: fx(layout.scoreAnchor.x), y: fy(layout.scoreAnchor.y) },
    scoreBox: layout.scoreBox
      ? {
          ...layout.scoreBox,
          slots: layout.scoreBox.slots.map((s) => ({ x: fx(s.x), y: fy(s.y), maxX: fx(s.maxX) })),
          mdSlot: layout.scoreBox.mdSlot
            ? { x: fx(layout.scoreBox.mdSlot.x), y: fy(layout.scoreBox.mdSlot.y), maxX: fx(layout.scoreBox.mdSlot.maxX) }
            : undefined,
        }
      : undefined,
    // Khung cắt của layout đã cắt = toàn trang.
    cropBox: { x0: 0, y0: 0, x1: 1, y1: 1 },
  };
}

/* ------------------------------------------------------------------ */
/* 1. Tìm 4 mốc vuông đen                                              */
/* ------------------------------------------------------------------ */

interface Blob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

/** Blob vuông ĐẶC (mốc in) trong ảnh xám. */
function squareBlobs(gray: GrayMat, thr = 100): Blob[] {
  const { width: W, height: H, data } = gray;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = data[i] < thr ? 1 : 0;
  const label = new Int32Array(W * H).fill(-1);
  const out: Blob[] = [];
  const stack: number[] = [];
  const minSide = Math.max(10, Math.round(Math.min(W, H) * 0.012));
  const maxSide = Math.round(Math.min(W, H) * 0.035);
  for (let s = 0; s < W * H; s++) {
    if (!dark[s] || label[s] >= 0) continue;
    const id = out.length;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p / W) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (dark[q] && label[q] < 0) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    // mốc in: vuông, đặc (fill cao), cỡ theo tỉ lệ ảnh
    if (w < minSide || w > maxSide || Math.abs(w - h) > Math.max(3, w * 0.25)) continue;
    if (n < w * h * 0.62) continue;
    out.push({ x0, y0, x1, y1, n });
  }
  return out;
}

/**
 * Chọn 4 blob làm mốc góc.
 *
 * ⚠️ Trên ảnh chụp thật, blob vuông KHÔNG chỉ có 4 mốc in: các ô đáp án học
 * sinh TÔ ĐẬM cũng thành blob vuông (đo ảnh Thu/11a8: mốc 65×69px n≈4100, ô tô
 * 43×45px n≈1300 — cùng "vuông đặc" nên lọt mọi bộ lọc hình dạng). Vì vậy chọn
 * theo GÓC + ĐỘ LỚN: trong vùng mỗi góc lấy blob CÓ DIỆN TÍCH LỚN NHẤT (mốc in
 * luôn to hơn nét bút tô), và 4 blob phải tạo thành tứ giác lớn phủ gần cả ảnh.
 */
function pickCornerMarkers(blobs: Blob[], W: number, H: number): [Pt, Pt, Pt, Pt] | null {
  if (blobs.length < 4) return null;
  const center = (b: Blob): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  /**
   * ỨNG VIÊN của một góc: blob trong vùng 32% quanh góc.
   *
   * ⚠️ KHÔNG chỉ lấy "lớn nhất": trên ảnh chụp thật, ô SBD/Mã đề học sinh tô
   * ĐẬM có thể to hơn mốc in (đo H5: ô tô ~52px vs mốc in ~34px) → chọn theo
   * diện tích bắt nhầm ô tô, quad sai (aspect 1.476 không mẫu nào) → cả phiếu
   * chuyển sang MOI. Ưu tiên: (a) GẦN GÓC TRANG nhất (mốc in luôn sát rìa
   * ~7–11% cạnh), (b) VUÔNG ĐẶC (fill cao), (c) cùng cỡ giữa 4 góc.
   */
  const pickCorner = (tx: number, ty: number) => {
    let best: { score: number; p: Pt; n: number } | null = null;
    for (const b of blobs) {
      const c = center(b);
      if (Math.abs(c.x - tx) > W * 0.32 || Math.abs(c.y - ty) > H * 0.32) continue;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const fill = b.n / Math.max(1, w * h);
      const sq = Math.abs(w - h) / Math.max(w, h); // 0 = vuông tuyệt đối
      if (fill < 0.62 || sq > 0.3) continue; // mốc in là ô VUÔNG ĐẶC
      const d = Math.hypot(c.x - tx, c.y - ty) / Math.hypot(W, H);
      /**
       * Ưu tiên DIỆN TÍCH trước, khoảng cách sau: mốc in LUÔN to hơn ô SBD/Mã
       * đề học sinh tô (đo FS_102250: mốc 15×15 n≈210 vs ô SBD 10×10 n≈80
       * cùng vùng góc). Trước đây score = 1 − d*2.2 làm ô nhỏ-gần-góc thắng
       * mốc to → blobQuad NULL → rơi về detectCornerMarkers (affine sai) →
       * warp hỏng → đổi mẫu oan.
       */
      const areaRank = Math.min(1, b.n / 900); // 0..1, mốc in ≈ 0.23–0.7
      const score = areaRank * 2.5 - d * 1.2;
      if (!best || score > best.score) best = { score, p: c, n: b.n };
    }
    return best;
  };
  const tl = pickCorner(W * 0.13, H * 0.13);
  const tr = pickCorner(W * 0.87, H * 0.13);
  const br = pickCorner(W * 0.87, H * 0.87);
  const bl = pickCorner(W * 0.13, H * 0.87);
  if (!tl || !tr || !br || !bl) return null;
  // 4 mốc phải CÙNG CỠ (mốc in đồng nhất) — chênh >2× nghĩa là đã bắt lẫn ô tô.
  const ns = [tl.n, tr.n, br.n, bl.n];
  if (Math.max(...ns) > Math.min(...ns) * 2) return null;
  // và tạo thành tứ giác lớn (phủ phần lớn ảnh)
  const quad = [tl.p, tr.p, br.p, bl.p] as [Pt, Pt, Pt, Pt];
  const area = Math.abs((quad[1].x - quad[0].x) * (quad[3].y - quad[0].y));
  if (area < W * H * 0.15) return null;
  // CẠN NGHIÊNG: mốc in trên phiếu ĐỨNG thì cạnh trên gần NGANG, cạnh trái
  // gần DỌC — ảnh chụp thật nghiêng/perspective ≤ ~20° (tan ≈ 0.36 cạnh). Tứ
  // giác bắt nhầm 4 blob nội dung (scan crop lệch, ô tô đậm) vi phạm rõ ràng —
  // đo trang scan 39 của file 81 trang: cạnh trên lệch dọc 0.43·span → loại.
  // Trả null → caller rơi về dò mốc của từng mẫu (detectCornerMarkers) thay vì
  // warp cả luồng bằng tứ giác sai.
  const top = { dx: quad[1].x - quad[0].x, dy: quad[1].y - quad[0].y };
  const right = { dx: quad[2].x - quad[1].x, dy: quad[2].y - quad[1].y };
  const left = { dx: quad[3].x - quad[0].x, dy: quad[3].y - quad[0].y };
  const bottom = { dx: quad[2].x - quad[3].x, dy: quad[2].y - quad[3].y };
  // So theo TRỤC CHỦ ĐẠO của từng cạnh: cạnh NGANG (trên/dưới) đo độ lệch dọc
  // theo |dy|/|dx|; cạnh DỌC (trái/phải) đo theo |dx|/|dy| — chia ngược trục
  // sẽ nổ khi cạnh gần thẳng đứng hoàn hảo (dx ≈ 0).
  const skewBad =
    top.dx <= 0 ||
    left.dy <= 0 ||
    Math.abs(top.dy) > 0.4 * Math.abs(top.dx) ||
    Math.abs(bottom.dy) > 0.4 * Math.abs(bottom.dx) ||
    Math.abs(right.dx) > 0.4 * Math.abs(right.dy) ||
    Math.abs(left.dx) > 0.4 * Math.abs(left.dy);
  if (skewBad) return null;
  return quad;
}

/**
 * Xuất cho pipeline: 4 tâm mốc vuông đặc trong ảnh (null nếu không đủ).
 * Chạy trên ẢNH THU NHỎ ≤1200px (connected components trên ảnh gốc 3456px tốn
 * ~0.6s; ở 1200px ~0.1s) rồi nhân toạ độ về ảnh gốc.
 */
export function pickCornerMarkersForCrop(gray: GrayMat): [Pt, Pt, Pt, Pt] | null {
  const scale = Math.min(1, 1200 / Math.max(gray.width, gray.height));
  if (scale >= 1) {
    const blobs = squareBlobs(gray);
    const quad = pickCornerMarkers(blobs, gray.width, gray.height);
    // Mất 1 mốc (bị che/bóng/ngón tay — đo FS_102250) → suy góc thứ 4 từ 3
    // mốc còn lại (hình bình hành) thay vì rơi về detectCornerMarkers (dò
    // affine sai, làm quad méo → warp hỏng → đổi mẫu oan).
    return quad ?? parallelogramFromThree(blobs, gray.width, gray.height, gray);
  }
  const small = resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale));
  const blobs = squareBlobs(small);
  const quad = pickCornerMarkers(blobs, small.width, small.height);
  const inv = 1 / scale;
  if (quad) return quad.map((p) => ({ x: p.x * inv, y: p.y * inv })) as [Pt, Pt, Pt, Pt];
  const para = parallelogramFromThree(blobs, small.width, small.height, small);
  return para ? (para.map((p) => ({ x: p.x * inv, y: p.y * inv })) as [Pt, Pt, Pt, Pt]) : null;
}

/**
 * SUY GÓC THỨ 4 TỪ 3 MỐC (khi 1 mốc bị che/mất).
 *
 * Với 3 mốc đã biết, góc còn lại = tổng vector của 2 góc kề trừ góc đối diện
 * (tính chất hình bình hành — đúng cho mẫu in có 4 mốc ở 4 góc chữ nhật, sai
 * số chỉ do phối cảnh). Chọn bộ 3 mốc "tốt nhất" theo tiêu chí:
 *  • mỗi mốc nằm gần MỘT góc trang khác nhau (không trùng góc),
 *  • 4 blob cùng cỡ (≤2×),
 *  • tứ giác sau khi suy ra gần đúng tỉ lệ trang (dùng kiểm tra độ nghiêng).
 *
 * Trả null khi không tìm được bộ 3 hợp lý (caller rơi về detectCornerMarkers).
 */
function parallelogramFromThree(
  blobs: Blob[],
  W: number,
  H: number,
  _gray: GrayMat,
): [Pt, Pt, Pt, Pt] | null {
  if (blobs.length < 3) return null;
  const center = (b: Blob): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  // nhóm blob theo 4 góc trang (vùng 32% như pickCornerMarkers)
  const zones: [number, number][] = [
    [W * 0.13, H * 0.13],
    [W * 0.87, H * 0.13],
    [W * 0.87, H * 0.87],
    [W * 0.13, H * 0.87],
  ];
  const perZone: { p: Pt; n: number }[][] = zones.map(([tx, ty]) => {
    const list: { p: Pt; n: number; score: number }[] = [];
    for (const b of blobs) {
      const c = center(b);
      if (Math.abs(c.x - tx) > W * 0.32 || Math.abs(c.y - ty) > H * 0.32) continue;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const fill = b.n / Math.max(1, w * h);
      const sq = Math.abs(w - h) / Math.max(w, h);
      if (fill < 0.62 || sq > 0.3) continue;
      const d = Math.hypot(c.x - tx, c.y - ty) / Math.hypot(W, H);
      // Cùng quy ước với pickCornerMarkers: DIỆN TÍCH trước, khoảng cách sau.
      list.push({ p: c, n: b.n, score: Math.min(1, b.n / 900) * 2.5 - d * 1.2 });
    }
    return list.sort((a, b) => b.score - a.score).map(({ p, n }) => ({ p, n }));
  });
  const missing = perZone.map((z, i) => (z.length === 0 ? i : -1)).filter((i) => i >= 0);
  // Chỉ suy khi ĐÚNG 1 góc trống (0 trống → pickCornerMarkers đã lo, ≥2 → không tin)
  if (missing.length !== 1) return null;
  const missIdx = missing[0];
  const picks = perZone.map((z) => z[0]);
  const ns = picks.filter(Boolean).map((p) => p.n);
  if (Math.max(...ns) > Math.min(...ns) * 2) return null;
  const q: Pt[] = picks.map((p) => (p ? p.p : { x: NaN, y: NaN }));
  // Hình bình hành: góc thiếu = góc kề 1 + góc kề 2 − góc đối diện
  // Thứ tự TL(0) TR(1) BR(2) BL(3): đối diện của i là (i+2)%4
  const opp = (missIdx + 2) % 4;
  const adj = [0, 1, 2, 3].filter((i) => i !== missIdx && i !== opp);
  q[missIdx] = {
    x: q[adj[0]].x + q[adj[1]].x - q[opp].x,
    y: q[adj[0]].y + q[adj[1]].y - q[opp].y,
  };
  const quad = q as [Pt, Pt, Pt, Pt];
  // cổng: tứ giác phải phủ phần lớn ảnh và các cạnh gần ngang/dọc
  const area = Math.abs((quad[1].x - quad[0].x) * (quad[3].y - quad[0].y));
  if (area < W * H * 0.15) return null;
  const top = { dx: quad[1].x - quad[0].x, dy: quad[1].y - quad[0].y };
  const left = { dx: quad[3].x - quad[0].x, dy: quad[3].y - quad[0].y };
  if (
    top.dx <= 0 ||
    left.dy <= 0 ||
    Math.abs(top.dy) > 0.4 * Math.abs(top.dx) ||
    Math.abs(left.dx) > 0.4 * Math.abs(left.dy)
  ) {
    return null;
  }
  return quad;
}

/* ------------------------------------------------------------------ */
/* 2. Ước lượng góc nghiêng (fallback khi mất mốc)                      */
/* ------------------------------------------------------------------ */

/**
 * Góc nghiêng của các ĐƯỜNG KẺ NGANG in sẵn: xoay thử một loạt góc, chọn góc
 * làm profile chiếu theo hàng "sắc" nhất (tổng bình phương hiệu giữa các hàng
 * liên tiếp lớn nhất = các đường kẻ thẳng hàng). Chỉ chạy trên ảnh thu nhỏ để
 * nhanh.
 */
export function estimateSkew(gray: GrayMat, maxDeg = 12): number {
  const scale = Math.min(1, 700 / Math.max(gray.width, gray.height));
  const small = scale < 1 ? resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale)) : gray;
  const { width: W, height: H, data } = small;
  // nhị phân mực
  const bin = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) bin[i] = data[i] < 150 ? 1 : 0;
  const scoreAt = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const tan = Math.tan(rad);
    const rows = new Float64Array(H + 2);
    const step = Math.max(1, Math.round(H / 400)); // lấy mẫu hàng để nhanh
    for (let y = 0; y < H; y += step) {
      const shift = (y - H / 2) * tan;
      let s = 0;
      for (let x = 0; x < W; x += 2) {
        const xs = Math.round(x + shift);
        if (xs < 0 || xs >= W) continue;
        s += bin[y * W + xs];
      }
      rows[y] = s;
    }
    let acc = 0;
    for (let y = step; y < H; y += step) acc += (rows[y] - rows[y - step]) ** 2;
    return acc;
  };
  let best = 0;
  let bestScore = scoreAt(0);
  for (let d = -maxDeg; d <= maxDeg; d += 0.5) {
    if (d === 0) continue;
    const s = scoreAt(d);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

/** Xoay ảnh quanh tâm một góc `deg` (dùng khi không có mốc). */
export function rotateGray(src: GrayMat, deg: number): GrayMat {
  if (Math.abs(deg) < 0.05) return src;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { width: W, height: H, data } = src;
  const out = new Uint8ClampedArray(W * H).fill(255);
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // nghịch đảo phép xoay
      const dx = x - cx;
      const dy = y - cy;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      const xi = Math.round(sx);
      const yi = Math.round(sy);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
      out[y * W + x] = data[yi * W + xi];
    }
  }
  return { width: W, height: H, data: out };
}

/* ------------------------------------------------------------------ */
/* 3. Lập kế hoạch cắt + thực hiện                                      */
/* ------------------------------------------------------------------ */

/**
 * Lập kế hoạch cắt ảnh theo khung đỏ của layout.
 *
 * @param markerQuad 4 tâm mốc trong ảnh gốc nếu đã dò được (từ
 *                   `detectCornerMarkers`); null thì dùng fallback góc nghiêng.
 */
export function planCrop(
  gray: GrayMat,
  layout: SheetLayout,
  markerQuad: [Pt, Pt, Pt, Pt] | null,
  opts: { targetWidth?: number; skipMarkers?: boolean } = {},
): CropPlan | null {
  const box = layout.cropBox;
  if (!box) return null;
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (!(bw > 0.05) || !(bh > 0.05)) return null;

  // Kích thước ảnh ra: giữ đúng tỉ lệ khung, bề rộng mặc định 1400px.
  const outW = Math.max(200, Math.round(opts.targetWidth ?? 1400));
  const outH = Math.max(200, Math.round((outW * bh * layout.height) / bw));

  const foundQuad = opts.skipMarkers
    ? null
    : markerQuad ?? pickCornerMarkers(squareBlobs(gray), gray.width, gray.height);
  if (foundQuad) {
    // 4 góc khung trong hệ "trang" (cùng hệ marker: layout.width=1, height=layout.height)
    const boxQuad: [Pt, Pt, Pt, Pt] = [
      { x: box.x0, y: box.y0 * layout.height },
      { x: box.x1, y: box.y0 * layout.height },
      { x: box.x1, y: box.y1 * layout.height },
      { x: box.x0, y: box.y1 * layout.height },
    ];
    const markerQuadCanon: [Pt, Pt, Pt, Pt] = [
      { x: layout.markers.tl.x, y: layout.markers.tl.y * layout.height },
      { x: layout.markers.tr.x, y: layout.markers.tr.y * layout.height },
      { x: layout.markers.br.x, y: layout.markers.br.y * layout.height },
      { x: layout.markers.bl.x, y: layout.markers.bl.y * layout.height },
    ];
    const map = quadPointMapper(markerQuadCanon, foundQuad);
    if (map) {
      const c = boxQuad.map((p) => map(p));
      if (c.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        return { quad: c as [Pt, Pt, Pt, Pt], outW, outH, byMarkers: true };
      }
    }
  }

  // ---- Fallback: xoay thẳng theo đường kẻ rồi cắt theo tỉ lệ khung ----
  const skew = estimateSkew(gray);
  const straightened = rotateGray(gray, skew);
  // Ước lượng vùng phiếu: bounding box của mực (bỏ outlier rìa)
  const bb = inkBounds(straightened);
  if (!bb) return null;
  const W2 = bb.x1 - bb.x0;
  const H2 = bb.y1 - bb.y0;
  // Toạ độ trả về phải ở hệ ẢNH GỐC (applyCrop warp từ ảnh gốc), nên xoay
  // ngược 4 góc vừa tính trong ảnh đã xoay.
  const boxQuadStraight: [Pt, Pt, Pt, Pt] = [
    { x: bb.x0 + W2 * box.x0, y: bb.y0 + H2 * box.y0 },
    { x: bb.x0 + W2 * box.x1, y: bb.y0 + H2 * box.y0 },
    { x: bb.x0 + W2 * box.x1, y: bb.y0 + H2 * box.y1 },
    { x: bb.x0 + W2 * box.x0, y: bb.y0 + H2 * box.y1 },
  ];
  // rotateGray xoay ảnh đi `skew` quanh tâm; để đưa điểm về ảnh gốc thì xoay
  // ngược quanh cùng tâm.
  const unrotate = rotatePointFn(gray.width, gray.height, -skew);
  const quad = boxQuadStraight.map((p) => unrotate(p)) as [Pt, Pt, Pt, Pt];
  return { quad, outW, outH, byMarkers: false, skewDeg: skew };
}

/** Hàm xoay điểm quanh tâm ảnh (cùng phép rotateGray, chiều ngược lại). */
function rotatePointFn(W: number, H: number, deg: number): (p: Pt) => Pt {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = W / 2;
  const cy = H / 2;
  return (p: Pt): Pt => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
}

/** Bounding box của mực (bỏ outlier 0.3% mỗi phía). */
function inkBounds(gray: GrayMat): { x0: number; y0: number; x1: number; y1: number } | null {
  const { width: W, height: H, data } = gray;
  let n = 0;
  for (let i = 0; i < W * H; i++) if (data[i] < 150) n++;
  if (n < W * H * 0.002) return null;
  const colCount = new Uint32Array(W);
  const rowCount = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[y * W + x] < 150) {
        colCount[x]++;
        rowCount[y]++;
      }
    }
  }
  const trim = Math.max(1, Math.round(W * 0.004));
  const nth = (arr: Uint32Array, k: number, fromEnd: boolean) => {
    let acc = 0;
    const idx = [...Array(arr.length).keys()];
    if (fromEnd) idx.reverse();
    for (const i of idx) {
      acc += arr[i];
      if (acc >= k) return i;
    }
    return fromEnd ? 0 : arr.length - 1;
  };
  const need = Math.max(2, Math.round(n * 0.004));
  const x0 = nth(colCount, need, false);
  const x1 = nth(colCount, need, true);
  const y0 = nth(rowCount, need, false);
  const y1 = nth(rowCount, need, true);
  void trim;
  if (x1 - x0 < W * 0.2 || y1 - y0 < H * 0.2) return null;
  return { x0, y0, x1, y1 };
}

/** Thực hiện cắt: warp ảnh gốc theo 4 góc khung → ảnh khung đỏ đã xoay thẳng. */
export function applyCrop(gray: GrayMat, plan: CropPlan): GrayMat {
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: plan.outW, y: 0 },
    { x: plan.outW, y: plan.outH },
    { x: 0, y: plan.outH },
  ];
  return warpQuadToMat(gray, plan.quad, dst, plan.outW, plan.outH);
}

/**
 * CÂN BẰNG SÁNG CỤC BỘ (flat-field) sau khi cắt.
 *
 * Ảnh chụp thật thường TỐI/LỆCH SÁNG THEO VÙNG (bóng đổ, đèn một phía): đo 5
 * ảnh Thu/11a8, vùng mã đề mean 132 · 21% pixel <120 trong khi vùng đáp án
 * mean 175 — đọc mã đề sai hoàn toàn (đo được "0", "405", "985" cho phiếu thật
 * mã 132). Kéo giãn histogram TOÀN ẢNH không sửa được lệch vùng.
 *
 * Cách làm — hiệu chỉnh nền cục bộ (illumination flattening):
 *  1. Nền cục bộ = ảnh thu nhỏ ~24 cột (mean mỗi ô) nội suy bilinear ngược về
 *     kích thước gốc — mượt, không nhòe nét mực (nét mực nhỏ hơn ô nền).
 *  2. out = clamp(255 × v / bg) — giấy tối được nâng sáng bằng đúng mức, mực
 *     vẫn tối hơn nền cục bộ của nó. Giới hạn hệ số khuếch đại ≤ 2.6 để không
 *     khuếch đại nhiễu ở vùng rất tối.
 * Nhanh hơn stretch toàn ảnh (nền tính trên ảnh thu nhỏ) và sửa đúng vùng.
 * Ảnh đã đều sáng (biên độ nền < 24) giữ nguyên.
 */
export function flattenIllumination(gray: GrayMat): GrayMat {
  const { width: W, height: H, data } = gray;
  // 1. nền cục bộ: downsample mean-per-tile
  const cols = 24;
  const rows = Math.max(8, Math.round((cols * H) / W));
  const bgSmall = new Float64Array(cols * rows);
  const cnt = new Float64Array(cols * rows);
  for (let y = 0; y < H; y++) {
    const rj = Math.min(rows - 1, Math.floor((y / H) * rows));
    for (let x = 0; x < W; x++) {
      const ci = Math.min(cols - 1, Math.floor((x / W) * cols));
      const k = rj * cols + ci;
      bgSmall[k] += data[y * W + x];
      cnt[k]++;
    }
  }
  let bgMin = 255;
  let bgMax = 0;
  for (let k = 0; k < bgSmall.length; k++) {
    bgSmall[k] = cnt[k] > 0 ? bgSmall[k] / cnt[k] : 200;
    if (bgSmall[k] < bgMin) bgMin = bgSmall[k];
    if (bgSmall[k] > bgMax) bgMax = bgSmall[k];
  }
  // ảnh đã đều sáng → giữ nguyên (tránh nhiễu hóa)
  if (bgMax - bgMin < 24) return gray;
  // nội suy bilinear ngược về kích thước gốc
  const bg = new Float64Array(W * H);
  const colsF = cols - 1;
  const rowsF = rows - 1;
  for (let y = 0; y < H; y++) {
    const fy = (y / H) * rowsF;
    const y0 = Math.min(rows - 1, Math.floor(fy));
    const y1 = Math.min(rows - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = (x / W) * colsF;
      const x0 = Math.min(cols - 1, Math.floor(fx));
      const x1 = Math.min(cols - 1, x0 + 1);
      const wx = fx - x0;
      const a = bgSmall[y0 * cols + x0] * (1 - wx) + bgSmall[y0 * cols + x1] * wx;
      const bb = bgSmall[y1 * cols + x0] * (1 - wx) + bgSmall[y1 * cols + x1] * wx;
      bg[y * W + x] = a * (1 - wy) + bb * wy;
    }
  }
  // 2. flat-field: v / bg, hệ số khuếch đại giới hạn
  const out = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) {
    const b = Math.max(30, bg[i]);
    let v = (data[i] / b) * 235;
    // giới hạn khuếch đại: pixel không được sáng hơn 2.6× giá trị gốc
    const lim = Math.min(255, data[i] * 2.6 + 30);
    if (v > lim) v = lim;
    out[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { width: W, height: H, data: out };
}

/** Tên cũ — giữ cho tương thích test/usage ngoài. */
export const equalizeContrast = flattenIllumination;
/* ------------------------------------------------------------------ */
/* 4. XOAY THẲNG + CẮT ẢNH MÀU (RGBA) cho preview                        */
/* ------------------------------------------------------------------ */

/**
 * Xoay thẳng ảnh RGBA (đã vẽ vòng đáp án) theo 4 mốc, rồi cắt đúng khung.
 *
 * @param rgba      ảnh đã annotate (cùng kích thước với `gray`)
 * @param gray      ảnh xám CÙNG kích thước — dùng dò lại 4 mốc
 * @param quad      4 tâm mốc đã biết trong ảnh này (từ bước crop)
 * @param outW      bề rộng ảnh ra (px)
 * @param aspect    tỉ lệ cao/rộng của khung (layout.height sau rescale)
 * @returns ảnh RGBA đã thẳng + cắt, hoặc null nếu không dò đủ mốc.
 *
 * Ảnh ra = đúng vùng giữa 4 mốc (nới 1.5% mỗi phía — `cropBox` của layout),
 * đã xoay thẳng theo 2 cạnh mốc — xử lý cả nghiêng lẫn phối cảnh.
 */
export function straightenRgbaByMarkers(
  rgba: { width: number; height: number; data: Uint8ClampedArray },
  gray: GrayMat,
  quad: [Pt, Pt, Pt, Pt],
  outW: number,
  aspect: number,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  // dò lại mốc trên ảnh xám cùng khung để lấy quad CHÍNH XÁC ở không gian này
  const q2 = pickCornerMarkersForCrop(gray) ?? quad;
  const tl = q2[0], tr = q2[1], br = q2[2], bl = q2[3];
  const spanX = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const spanY = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  if (spanX < 20 || spanY < 20) return null;
  const outH = Math.max(200, Math.round(outW * aspect));
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  // warp RGBA 4 kênh bilinear
  const src = rgba;
  const out = new Uint8ClampedArray(outW * outH * 4);
  // homography dst → src (điểm ảnh ra → điểm ảnh nguồn)
  const [d0, d1, d2, d3] = dst;
  const [s0, s1, s2, s3] = [tl, tr, br, bl];
  // giải hệ homography 8 ẩn (chuẩn least-squares 4 cặp)
  const solve = () => {
    const A: number[][] = [];
    const bv: number[] = [];
    const push = (dstP: Pt, srcP: Pt, row: number) => {
      const { x: u, y: v } = dstP;
      const { x: X, y: Y } = srcP;
      A.push([u, v, 1, 0, 0, 0, -X * u, -X * v]);
      bv.push(X);
      A.push([0, 0, 0, u, v, 1, -Y * u, -Y * v]);
      bv.push(Y);
    };
    push(d0, s0, 0);
    push(d1, s1, 1);
    push(d2, s2, 2);
    push(d3, s3, 3);
    // Gaussian elimination 8×8
    const n = 8;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r2 = col + 1; r2 < n; r2++) if (Math.abs(A[r2][col]) > Math.abs(A[piv][col])) piv = r2;
      [A[col], A[piv]] = [A[piv], A[col]];
      [bv[col], bv[piv]] = [bv[piv], bv[col]];
      const d = A[col][col];
      if (Math.abs(d) < 1e-9) return null;
      for (let r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        const f = A[r2][col] / d;
        for (let cc = col; cc < n; cc++) A[r2][cc] -= f * A[col][cc];
        bv[r2] -= f * bv[col];
      }
    }
    return bv.map((v, i) => v / A[i][i]);
  };
  const hmtx = solve();
  if (!hmtx) return null;
  const [a, bb, c, d, e, f, g, h] = hmtx;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = g * x + h * y + 1;
      const sx = (a * x + bb * y + c) / den;
      const sy = (d * x + e * y + f) / den;
      const xi = Math.round(sx);
      const yi = Math.round(sy);
      const o = (y * outW + x) * 4;
      if (xi < 0 || yi < 0 || xi >= src.width || yi >= src.height) {
        out[o] = 235; out[o + 1] = 235; out[o + 2] = 235; out[o + 3] = 255;
        continue;
      }
      const si = (yi * src.width + xi) * 4;
      out[o] = src.data[si];
      out[o + 1] = src.data[si + 1];
      out[o + 2] = src.data[si + 2];
      out[o + 3] = 255;
    }
  }
  return { width: outW, height: outH, data: out };
}
