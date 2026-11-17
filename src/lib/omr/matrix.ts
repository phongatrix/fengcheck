/**
 * Grayscale image primitives shared by the OMR pipeline.
 * A "mat" is a plain struct over a Uint8ClampedArray (row-major, 0..255).
 */

import type { GrayMat, Pt } from "./types";

export function createMat(width: number, height: number, fill = 255): GrayMat {
  const data = new Uint8ClampedArray(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/** Build a grayscale mat from RGBA ImageData with BT.601 luma. */
export function fromImageData(imageData: ImageData): GrayMat {
  const { data } = imageData;
  const width = imageData.width;
  const height = imageData.height;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return { width, height, data: out };
}

/** Same as {@link fromImageData} but over a raw RGBA buffer (Web Worker path). */
export function fromRgba(buf: ArrayBufferLike, width: number, height: number): GrayMat {
  const data = new Uint8ClampedArray(buf);
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return { width, height, data: out };
}

export function toImageData(mat: GrayMat): ImageData {
  const { width, height, data } = mat;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    out[j] = data[i];
    out[j + 1] = data[i];
    out[j + 2] = data[i];
    out[j + 3] = 255;
  }
  return new ImageData(out, width, height);
}

/** 3x3 median filter — kills salt-and-pepper/speckle noise, keeps edges. */
export function medianFilter3(mat: GrayMat): GrayMat {
  const { width, height, data } = mat;
  const out = new Uint8ClampedArray(width * height);
  const win = new Uint8Array(9);
  for (let y = 0; y < height; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < height - 1 ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < width - 1 ? x + 1 : width - 1;
      let k = 0;
      for (const yy of [ym, y, yp]) {
        const base = yy * width;
        win[k++] = data[base + xm];
        win[k++] = data[base + x];
        win[k++] = data[base + xp];
      }
      // insertion sort of 9
      for (let i = 1; i < 9; i++) {
        const v = win[i];
        let j = i - 1;
        while (j >= 0 && win[j] > v) {
          win[j + 1] = win[j];
          j--;
        }
        win[j + 1] = v;
      }
      out[y * width + x] = win[4];
    }
  }
  return { width, height, data: out };
}

/** 3x3 Gaussian blur (sigma ≈ 1). */
export function gaussianBlur3(mat: GrayMat): GrayMat {
  const { width, height, data } = mat;
  const out = new Uint8ClampedArray(width * height);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const norm = 16;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          s += data[yy * width + xx] * k[ki++];
        }
      }
      out[y * width + x] = s / norm;
    }
  }
  return { width, height, data: out };
}

/**
 * Adaptive threshold producing a binary mat where dark ink is 255 (foreground).
 * Matches OpenCV's ADAPTIVE_THRESH_MEAN_C / THRESH_BINARY_INV:
 *   out = src < mean - C ? 255 : 0
 */
export function adaptiveThresholdInv(mat: GrayMat, blockSize: number, c: number): GrayMat {
  const { width, height, data } = mat;
  const out = new Uint8ClampedArray(width * height);
  const half = Math.max(1, Math.floor(blockSize / 2));
  const stride = width + 1;
  const sum = new Float64Array((height + 1) * stride);
  for (let y = 0; y < height; y++) {
    let row = 0;
    const base = y * width;
    const cur = (y + 1) * stride;
    const prev = y * stride;
    for (let x = 0; x < width; x++) {
      row += data[base + x];
      sum[cur + x + 1] = sum[prev + x + 1] + row;
    }
  }
  const boxSum = (y0: number, x0: number, y1: number, x1: number): number =>
    sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const mean = boxSum(y0, x0, y1, x1) / ((y1 - y0) * (x1 - x0));
      out[base + x] = data[base + x] < mean - c ? 255 : 0;
    }
  }
  return { width, height, data: out };
}

/** Otsu's global threshold; returns the threshold value. */
export function otsuThreshold(mat: GrayMat): number {
  const { data } = mat;
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const total = data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let best = 127;
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
  return best;
}

/** Global bright threshold into foreground=255 (bright pixels, e.g. paper). */
export function thresholdBright(mat: GrayMat, thresh: number): GrayMat {
  const { width, height, data } = mat;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) out[i] = data[i] > thresh ? 255 : 0;
  return { width, height, data: out };
}

/** Global binary threshold into foreground=255 (dark pixels). */
export function thresholdInv(mat: GrayMat, thresh: number): GrayMat {
  const { width, height, data } = mat;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) out[i] = data[i] < thresh ? 255 : 0;
  return { width, height, data: out };
}

export function countNonZero(mat: GrayMat, r: { x: number; y: number; w: number; h: number }): number {
  const { width, height, data } = mat;
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const base = y * width;
    for (let x = x0; x < x1; x++) if (data[base + x] !== 0) n++;
  }
  return n;
}

export function meanRect(mat: GrayMat, r: { x: number; y: number; w: number; h: number }): number {
  const { width, height, data } = mat;
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return 0;
  let s = 0;
  for (let y = y0; y < y1; y++) {
    const base = y * width;
    for (let x = x0; x < x1; x++) s += data[base + x];
  }
  return s / ((x1 - x0) * (y1 - y0));
}

/** Variance of the Laplacian — the sharpness metric used by the original app. */
export function laplacianVariance(mat: GrayMat): number {
  const { width, height, data } = mat;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Bilinear sample. Out-of-bounds returns `fallback`. */
export function sampleBilinear(mat: GrayMat, x: number, y: number, fallback = 255): number {
  const { width, height, data } = mat;
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return fallback;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = data[y0 * width + x0];
  const i10 = data[y0 * width + x0 + 1];
  const i01 = data[(y0 + 1) * width + x0];
  const i11 = data[(y0 + 1) * width + x0 + 1];
  return (
    i00 * (1 - fx) * (1 - fy) +
    i10 * fx * (1 - fy) +
    i01 * (1 - fx) * fy +
    i11 * fx * fy
  );
}

/**
 * Projective warp. Builds the homography taking `srcQuad` to `dstQuad`, then
 * renders `dstQuad`'s bounding box into a `width`×`height` image by sampling
 * the source. Points are TL, TR, BR, BL.
 */
export function warpQuadToMat(
  src: GrayMat,
  srcQuad: [Pt, Pt, Pt, Pt],
  dstQuad: [Pt, Pt, Pt, Pt],
  width: number,
  height: number,
): GrayMat {
  // Map destination pixels back to source coordinates.
  const H = quadHomography(dstQuad, srcQuad);
  if (!H) return createMat(Math.max(1, width), Math.max(1, height));
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / w;
      const sy = (H[3] * x + H[4] * y + H[5]) / w;
      out[y * width + x] = sampleBilinear(src, sx, sy, 255);
    }
  }
  return { width, height, data: out };
}

type H3 = [number, number, number, number, number, number, number, number, number];

/**
 * Homography từ quad này sang quad kia, dùng được ở ngoài: trả hàm ánh xạ
 * điểm. Dùng để vẽ lưới đáp án lên ẢNH GỐC (không warp ảnh) — toạ độ canonical
 * của bubble được ánh xạ về đúng vị trí trên ảnh chụp qua `dstQuad → srcQuad`.
 */
export function quadPointMapper(
  from: [Pt, Pt, Pt, Pt],
  to: [Pt, Pt, Pt, Pt],
): ((p: Pt) => Pt) | null {
  const H = quadHomography(from, to);
  if (!H) return null;
  return (p: Pt) => {
    const w = H[6] * p.x + H[7] * p.y + H[8];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return { x: NaN, y: NaN };
    return {
      x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
      y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
    };
  };
}

function quadHomography(src: [Pt, Pt, Pt, Pt], dst: [Pt, Pt, Pt, Pt]): H3 | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = gaussSolve(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
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
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Area-average downscale (used for fast previews and marker search). */
export function resizeMat(src: GrayMat, dstW: number, dstH: number): GrayMat {
  const { width, height, data } = src;
  if (dstW === width && dstH === height) return src;
  const out = new Uint8ClampedArray(dstW * dstH);
  const sx = width / dstW;
  const sy = height / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(height, Math.ceil((y + 1) * sy));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(width, Math.ceil((x + 1) * sx));
      let s = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        const base = yy * width;
        for (let xx = x0; xx < x1; xx++) {
          s += data[base + xx];
          n++;
        }
      }
      out[y * dstW + x] = n ? s / n : 255;
    }
  }
  return { width: dstW, height: dstH, data: out };
}
