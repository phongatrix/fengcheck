/**
 * TIỀN XỬ LÝ ẢNH trước khi chấm — đưa ảnh về dạng "chuẩn" cho bộ đọc OMR.
 *
 * Ba lớp lỗi thực đo được trên ảnh người dùng gửi (2026-11-17):
 *  1. ẢNH NGHIÊNG NHẸ (0.5–1.5°): đủ để lưới ô in lệch dần theo chiều dọc —
 *     đo được lệch vành 10px ở cuối trang (P1 câu 2/5 lệch (2,−10)) dù đầu
 *     trang khớp. Bộ đọc có snap/grid-fit nhưng chúng bị "đuối" khi lệch tích
 *     luỹ → chấm sai các câu cuối.
 *  2. DẢI ĐEN / VIỀN KHUNG ở mép ảnh (scan lẫn viền tối, tab trình duyệt, nền
 *     bàn): blob tối chạy hết chiều rộng (1500×22 tại y=11 và y=2105) làm
 *     `pickCornerMarkersForCrop` bắt nhầm thành mốc góc → warp cả trang sai →
 *     ảnh kết quả có vòng khoanh chồng/lệch.
 *  3. NỘI DUNG CHẠM MÉP (crop sát mép giấy): không còn lề trắng để dò vòng ô
 *     ngoài cùng; mốc in cũng có thể bị cắt.
 *
 * Hướng xử lý (không dùng OpenCV — giữ thuần TS chạy trong Web Worker):
 *  • `trimBlackBands`: tìm dải hàng/cột TỐI gần như đều ở 4 mép (mean < 90 và
 *    độ lệch chuẩn thấp) → cắt bỏ, cộng lại lề trắng 2%.
 *  • `autoDeskew`: quét góc ±6° (bước 0.5°, tinh chỉnh 0.1°) chọn góc làm
 *    profile chiếu HÀNG sắc nhất (đường kẻ in + hàng bubble thẳng hàng) —
 *    ảnh hưởng trực tiếp tới lưới; chỉ nhận khi cải thiện ≥ 8% (tránh xoay
 *    ảnh vốn đã thẳng).
 *  • `ensureMargins`: nếu mực chạm mép (<1.5% cạnh) thì đệm nền trắng để bộ
 *    dò vòng/mốc có đủ ngữ cảnh.
 *
 * Toàn bộ chạy trên ảnh ≤1800px nên rẻ (~0.1–0.3s/ảnh); mọi hàm trả ảnh MỚI
 * và KHÔNG đổi toạ độ của ảnh gốc khi không cần (trả chính object đầu vào).
 */
import type { GrayMat } from "./types";
import { resizeMat } from "./matrix";

/** Cắt dải đen/viền tối ở 4 mép + đệm lề trắng. Trả nguyên ảnh nếu không có. */
export function trimBlackBands(gray: GrayMat, opts: { padRatio?: number } = {}): GrayMat {
  const { width: W, height: H, data } = gray;
  const padRatio = opts.padRatio ?? 0.02;
  /** hàng (hoặc cột) coi là "dải đen": mean < 90 và std < 28 */
  const lineStats = (axis: "row" | "col", i: number) => {
    const n = axis === "row" ? W : H;
    let sum = 0;
    let sum2 = 0;
    for (let k = 0; k < n; k++) {
      const v = axis === "row" ? data[i * W + k] : data[k * W + i];
      sum += v;
      sum2 += v * v;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  };
  const darkLine = (axis: "row" | "col", i: number) => {
    const s = lineStats(axis, i);
    return s.mean < 90 && s.std < 28;
  };
  // quét từ mép vào, tối đa 12% kích thước
  const maxRow = Math.round(H * 0.12);
  const maxCol = Math.round(W * 0.12);
  let top = 0;
  while (top < maxRow && darkLine("row", top)) top++;
  let bottom = H - 1;
  while (bottom > H - 1 - maxRow && darkLine("row", bottom)) bottom--;
  let left = 0;
  while (left < maxCol && darkLine("col", left)) left++;
  let right = W - 1;
  while (right > W - 1 - maxCol && darkLine("col", right)) right--;
  if (top === 0 && bottom === H - 1 && left === 0 && right === W - 1) return gray;
  const bw = right - left + 1;
  const bh = bottom - top + 1;
  if (bw < W * 0.5 || bh < H * 0.5) return gray; // cắt quá nhiều → nghi ngờ, bỏ qua
  const padX = Math.round(bw * padRatio);
  const padY = Math.round(bh * padRatio);
  const outW = bw + padX * 2;
  const outH = bh + padY * 2;
  const out = new Uint8ClampedArray(outW * outH).fill(255);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      out[(y + padY) * outW + (x + padX)] = data[(y + top) * W + (x + left)];
    }
  }
  return { width: outW, height: outH, data: out };
}

/** Điểm sắc profile hàng (tổng |đạo hàm| trung bình mực theo hàng). */
function rowSharpness(gray: GrayMat): number {
  const { width: W, height: H, data } = gray;
  const prof = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += 255 - data[y * W + x];
    prof[y] = s / W;
  }
  let acc = 0;
  for (let y = 1; y < H; y++) acc += Math.abs(prof[y] - prof[y - 1]);
  return acc / H;
}

/**
 * Tự làm thẳng ảnh bằng cách TÌM GÓC nghiêng theo profile chiếu hàng.
 * Chỉ nhận khi độ sắc tăng ≥ `minGain` (mặc định 8%) — ảnh vốn thẳng không bị
 * xoay thêm (xoay làm mất mép, có thể cắt mất mốc).
 */
export function autoDeskew(
  gray: GrayMat,
  opts: { maxDeg?: number; minGain?: number; minDeg?: number } = {},
): { image: GrayMat; deg: number } {
  const maxDeg = opts.maxDeg ?? 6;
  // Ngưỡng cải thiện 22% + góc ≥0.3°: profile hàng rất "phẳng" trên scan chất
  // lượng cao (mọi góc gần như bằng nhau) nên ngưỡng thấp (8%) xoay oan ảnh
  // vốn thẳng — đo được làm hỏng 3/12 trang Tin 12 (12/12 → 9/12). Ảnh nghiêng
  // THẬT cho cải thiện 19–47% (đo A: +47%, B: +19%).
  const minGain = opts.minGain ?? 0.22;
  const minDeg = opts.minDeg ?? 0.3;
  const base = rowSharpness(gray);
  if (!(base > 0)) return { image: gray, deg: 0 };
  // ảnh lớn thì thu nhỏ để quét nhanh (góc không phụ thuộc độ phân giải)
  const scale = Math.min(1, 900 / Math.max(gray.width, gray.height));
  const probe = scale < 1 ? resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale)) : gray;
  let best = { deg: 0, sc: base };
  for (let deg = -maxDeg; deg <= maxDeg; deg += 0.5) {
    if (Math.abs(deg) < 0.01) continue;
    const sc = rowSharpness(rotateGrayFast(probe, deg));
    if (sc > best.sc) best = { deg, sc };
  }
  // tinh chỉnh ±0.5° bước 0.1°
  const coarse = best.deg;
  for (let deg = coarse - 0.4; deg <= coarse + 0.4; deg += 0.1) {
    if (Math.abs(deg) < 0.01) continue;
    const sc = rowSharpness(rotateGrayFast(probe, deg));
    if (sc > best.sc) best = { deg, sc };
  }
  if (best.sc < base * (1 + minGain) || Math.abs(best.deg) < minDeg) return { image: gray, deg: 0 };
  const rotated = rotateGrayFast(gray, best.deg);
  return { image: rotated, deg: Number(best.deg.toFixed(2)) };
}

/**
 * Xoay ảnh xám (nearest-neighbour) quanh tâm, giữ nguyên khung. Bản nhanh hơn
 * `rotateGray` của sheet-crop: không cấp phát ma trận toạ độ, dùng hệ số
 * cos/sin tính sẵn. Vùng ngoài ảnh gốc để trắng (không đen — tránh tạo "dải
 * đen" giả ở mép).
 */
export function rotateGrayFast(gray: GrayMat, deg: number): GrayMat {
  const { width: W, height: H, data } = gray;
  if (Math.abs(deg) < 0.05) return gray;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = W / 2;
  const cy = H / 2;
  const out = new Uint8ClampedArray(W * H).fill(255);
  for (let y = 0; y < H; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      // toạ độ nguồn: xoay ngược
      const sx = Math.round(cx + dx * cos + dy * sin);
      const sy = Math.round(cy - dx * sin + dy * cos);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      out[y * W + x] = data[sy * W + sx];
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * Đệm lề trắng nếu MỰC CHẠM MÉP (mép bị cắt cụt): bộ dò vòng/mốc cần ngữ cảnh
 * vài % xung quanh; ảnh crop sát giấy làm vòng ngoài cùng dính mép, ring
 * density bị nhiễu.
 */
export function ensureMargins(gray: GrayMat, minRatio = 0.015): GrayMat {
  const { width: W, height: H, data } = gray;
  const bandX = Math.max(1, Math.round(W * minRatio));
  const bandY = Math.max(1, Math.round(H * minRatio));
  const hit = (x0: number, y0: number, x1: number, y1: number) => {
    let dark = 0;
    let tot = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        tot++;
        if (data[y * W + x] < 128) dark++;
      }
    }
    return tot > 0 ? dark / tot > 0.02 : false;
  };
  const touch =
    hit(0, 0, bandX, H) || hit(W - bandX, 0, W, H) || hit(0, 0, W, bandY) || hit(0, H - bandY, W, H);
  if (!touch) return gray;
  const padX = Math.round(W * 0.04);
  const padY = Math.round(H * 0.04);
  const outW = W + padX * 2;
  const outH = H + padY * 2;
  const out = new Uint8ClampedArray(outW * outH).fill(255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[(y + padY) * outW + (x + padX)] = data[y * W + x];
    }
  }
  return { width: outW, height: outH, data: out };
}

/**
 * CHUỖI TIỀN XỬ LÝ cho ảnh UPLOAD — chạy trước mọi bước chấm.
 * Thứ tự quan trọng:
 *  1. cắt dải đen ở mép  (nếu không, chúng bị coi là mốc/nền);
 *  2. đệm lề trắng       (để xoay không cắt mất nội dung sát mép);
 *  3. làm thẳng          (profile hàng sắc nhất — tác động trực tiếp lưới);
 *  4. cắt dải đen lần 2  (xoay sinh góc trắng, nhưng nếu ảnh có viền tối thì
 *                        viền đã xoay nghiêng → cắt theo hàng/cột vẫn bắt được).
 */
export function preprocessUpload(
  gray: GrayMat,
  opts: { deskew?: boolean; trim?: boolean; pad?: boolean } = {},
): { image: GrayMat; skewDeg: number; trimmed: boolean } {
  const wantTrim = opts.trim !== false;
  const wantPad = opts.pad !== false;
  const wantDeskew = opts.deskew !== false;
  let img = gray;
  let trimmed = false;
  if (wantTrim) {
    const t = trimBlackBands(img);
    if (t !== img) {
      img = t;
      trimmed = true;
    }
  }
  if (wantPad) img = ensureMargins(img);
  let skewDeg = 0;
  if (wantDeskew) {
    const d = autoDeskew(img);
    img = d.image;
    skewDeg = d.deg;
  }
  if (wantTrim && skewDeg !== 0) {
    const t = trimBlackBands(img);
    if (t !== img) {
      img = t;
      trimmed = true;
    }
  }
  return { image: img, skewDeg, trimmed };
}
