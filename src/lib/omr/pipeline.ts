/** End-to-end OMR pipeline: image → aligned sheet → answers → annotated preview. */

import type { FormConfig, FormKind, GrayMat, Pt, ReadQuestion, SheetLayout } from "./types";
import { canonicalSheet } from "./sheet";
import { detectCornerMarkers, type MarkerAnchor, type MarkerDetectResult } from "./markers";
import { warpQuadToMat, laplacianVariance, quadPointMapper, resizeMat } from "./matrix";
import { annotateSheet, inkMap, readCanonicalSheet } from "./reader";
import { alignP1BlocksByLabels, estimateSectionShifts, fitGridByProfile, fitGridCorrection, ringAlignmentScore } from "./grid-fit";
import { applyCrop, flattenIllumination, pickCornerMarkersForCrop, planCrop, rescaleLayout } from "./sheet-crop";
import { preprocessUpload } from "./preprocess";
import { processWithFormDetection, readQuality, codeMatchesKeys, GOOD_QUALITY, type FormDetectResult } from "./form-detect";
import type { SheetReadInternal } from "./reader";

export interface ProcessOptions {
  form: FormConfig;
  /** Answers of the exam key for this paper, for annotation colours. */
  keyAnswers?: number[] | null;
  /** Disable the sharpness gate (used for file uploads with soft focus). */
  checkSharpness?: boolean;
  /**
   * Chỉ warp + đọc MỘT lượt, bỏ các lớp hiệu chỉnh (band-shift theo nhóm,
   * grid-fit) và không dựng preview. Dùng cho các lượt THỬ MẪU GIẤY: rẻ hơn
   * ~4× và đủ để so sánh tương đối giữa các mẫu. Không dùng cho bản đọc chính.
   */
  probeOnly?: boolean;
  /**
   * CẮT ẢNH THEO KHUNG ĐỎ của mẫu trước khi chấm (mẫu khai báo `cropBox`).
   * Dùng cho ảnh UPLOAD: xoay thẳng theo 4 mốc in / đường kẻ rồi cắt đúng vùng
   * khung đỏ — loại nền bàn, mép giấy xiên; lưới đáp án luôn tính trên cùng
   * một khung tham chiếu. Không bật cho ảnh webcam (đã canh khung sẵn) để
   * không thêm một lần warp nữa.
   */
  cropToBox?: boolean;
  /**
   * Layout ĐÃ RESCALE (dùng nội bộ sau khi cắt ảnh theo khung đỏ): thay cho
   * `canonicalSheet(opts.form)`. Caller thường dùng `processGrayWithCrop`
   * thay vì truyền trực tiếp.
   */
  /** Đáp án chuẩn cho màu vòng + khối kết quả (worker truyền xuống). */
  keys?: { code: string; answers: number[] }[] | null;
  layoutOverride?: SheetLayout;
  /**
   * Quad 4 mốc ĐÃ BIẾT TRƯỚC trong toạ độ ảnh đầu vào (từ bước cắt): bỏ qua
   * detectCornerMarkers — tiết kiệm ~0.25s/lượt và tránh dò sai lần nữa.
   */
  markerQuadOverride?: [Pt, Pt, Pt, Pt];
  /**
   * ẢNH WARP CÓ SẮN (canonical của lượt probe CÙNG mẫu, cùng quad ghim): tái
   * dùng thay vì warp lại từ đầu (~0.3s). Chỉ có hiệu lực khi `markerQuadOverride`
   * cũng được truyền và kích thước khớp không gian chuẩn của layout — processGray
   * tự kiểm tra, sai là bỏ qua.
   */
  preWarped?: GrayMat;
  /**
   * Thu nhỏ KHÔNG GIAN CANONICAL khi đọc (0.5 = 500×~707). Dùng cho các lượt
   * PROBE mẫu giấy: chất lượng giảm nhẹ nhưng thứ hạng giữa các mẫu giữ nguyên,
   * chi phí inkMap/đọc giảm ~4×. Bản đọc chính thức luôn dùng 1.
   */
  canonicalScale?: number;
}

export interface ProcessResult {
  ok: boolean;
  /** Human readable failure reason. */
  error?: string;
  /** Warped canonical grayscale mat, kept for re-annotation after grading. */
  canonical?: { width: number; height: number; data: Uint8ClampedArray };
  /** RGBA preview with answer circles drawn (no score text yet). */
  preview?: { width: number; height: number; rgba: Uint8ClampedArray };
  /** Detected paper corners in source-image coordinates (TL,TR,BR,BL). */
  markers?: Pt[];
  /** True khi 4 marker được xác nhận đúng vị trí của layout (không phải đoán theo mép giấy). */
  markersConfirmed?: boolean;
  sharpness?: number;
  answers?: number[];
  questions?: ReadQuestion[];
  /** PHẦN III digits: per numeric câu, per digit column (0..9, -1 blank). */
  part3?: number[][];
  /** PHẦN III ô dấu (− / dấu thập phân), song song `part3` — null khi câu không có dấu. */
  part3Signs?: ({ neg: boolean; comma: number } | null)[];
  examCode?: string | null;
  studentCode?: string | null;
  readError?: boolean;
  /** Canonical layout used for this sheet, so callers can draw/print it. */
  layout: SheetLayout;
  /**
   * Ánh xạ toạ độ CANONICAL (không gian bộ đọc dùng) → ẢNH GỐC ĐÃ THU NHỎ về
   * `source` (cùng kích thước với `preview`). Dùng để vẽ lưới lên chính ảnh
   * upload. ⚠️ KHÔNG phải toạ độ ảnh gốc full-res — cần full-res thì nhân với
   * (gray.width / source.width).
   */
  toSource?: (p: Pt) => Pt;
  /** Ảnh gốc (grayscale) đã dùng để chấm — nền preview khi không warp. */
  source?: GrayMat;
  /** Kích thước không gian canonical (px) mà `layout` được tính theo. */
  canonicalSize?: { width: number; height: number };
}

const CANONICAL_WIDTH = 1000;

/**
 * Destination quad for the perspective warp: the layout's own marker positions
 * scaled to canonical pixels. Warping the detected corner markers onto these
 * keeps every layout coordinate (bubbles, digit grids) aligned — warping to
 * the full rect would zoom/crop by the marker inset instead.
 */
function canonicalMarkerQuad(layout: SheetLayout, w: number, h: number): [Pt, Pt, Pt, Pt] {
  const m = layout.markers;
  return [
    { x: m.tl.x * w, y: m.tl.y * h },
    { x: m.tr.x * w, y: m.tr.y * h },
    { x: m.br.x * w, y: m.br.y * h },
    { x: m.bl.x * w, y: m.bl.y * h },
  ];
}

function grayToRgba(gray: { width: number; height: number; data: Uint8ClampedArray }): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0, j = 0; i < gray.data.length; i++, j += 4) {
    rgba[j] = gray.data[i];
    rgba[j + 1] = gray.data[i];
    rgba[j + 2] = gray.data[i];
    rgba[j + 3] = 255;
  }
  return rgba;
}

/**
 * Full pass: detect corner markers → perspective warp → read bubbles/codes.
 * `checkSharpness: false` for uploads, `true` for live webcam frames.
 */
export function processGray(
  gray: { width: number; height: number; data: Uint8ClampedArray },
  opts: ProcessOptions,
): ProcessResult {
  const layout = opts.layoutOverride ?? canonicalSheet(opts.form);
  const cScale = opts.canonicalScale ?? 1;
  const CAN = Math.round(CANONICAL_WIDTH * cScale);
  const canonicalHeight = Math.round(CAN / (layout.width / layout.height));
  // Ảnh warp có sẵn (probe của CÙNG mẫu đã chạy trước) — chỉ nhận khi đúng cỡ
  // không gian chuẩn của layout này và quad nguồn bị GHIM (markerQuadOverride):
  // nếu tự dò mốc thì probe có thể dò được quad khác → ảnh cũ sai khung.
  const preWarped =
    opts.preWarped &&
    opts.markerQuadOverride &&
    opts.preWarped.width === CAN &&
    opts.preWarped.height === canonicalHeight
      ? opts.preWarped
      : undefined;

  const fractions: [MarkerAnchor, MarkerAnchor, MarkerAnchor, MarkerAnchor] = [
    layout.markers.tl,
    layout.markers.tr,
    layout.markers.br,
    layout.markers.bl,
  ];
  const detect: MarkerDetectResult =
    opts.markerQuadOverride && opts.markerQuadOverride.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      ? {
          ok: true,
          quad: opts.markerQuadOverride,
          quadIsPaper: false,
          markers: opts.markerQuadOverride.map((p) => ({
            x: p.x, y: p.y, w: 0, h: 0, area: 0, fill: 0, cx: p.x, cy: p.y,
          })),
          sharpness: 1,
          message: undefined,
          quadApprox: undefined,
          candidates: 0,
        }
      : detectCornerMarkers(gray, {
          checkSharpness: opts.checkSharpness !== false,
          markerFractions: fractions,
          pageAspect: layout.width / layout.height,
        });
  if (!detect.ok || !detect.quad) {
    return {
      ok: false,
      error: detect.message ?? "Không tìm thấy 4 góc phiếu",
      markers: detect.markers.map((m) => ({ x: m.cx, y: m.cy })),
      sharpness: detect.sharpness,
      layout,
    };
  }

  // Marker quad → marker positions; paper quad → the full page.
  const dstQuad: [Pt, Pt, Pt, Pt] = detect.quadIsPaper
    ? [
        { x: 0, y: 0 },
        { x: CAN, y: 0 },
        { x: CAN, y: canonicalHeight },
        { x: 0, y: canonicalHeight },
      ]
    : canonicalMarkerQuad(layout, CAN, canonicalHeight);

  /**
   * Đệm ảnh warp theo KHUNG đích: các lớp hiệu chỉnh (shift nhóm, neo nhãn số
   * câu) đọc LẠI với layout đã dịch nhưng khung warp KHÔNG ĐỔI → warp lặp lại
   * y hệt (~0.3s/lần). Kết quả warp chỉ phụ thuộc (ảnh, quad nguồn, khung đích)
   * nên dùng lại an toàn; khung đổi (tryCorrection) thì tự tính mới.
   */
  const warpCache = new Map<string, GrayMat>();
  const dstKey = (d: [Pt, Pt, Pt, Pt]) => d.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("|");

  const warpRead = (dst: [Pt, Pt, Pt, Pt], lay: SheetLayout = layout) => {
    const key = dstKey(dst);
    let w = warpCache.get(key);
    if (!w) {
      w = preWarped && key === dstKey(dstQuad) ? preWarped : warpQuadToMat(gray, detect.quad!, dst, CAN, canonicalHeight);
      warpCache.set(key, w);
    }
    const pairs: { ex: number; ey: number; ax: number; ay: number }[] = [];
    const r = readCanonicalSheet(w, lay, {
      readExamCode: opts.form.useExamCode && !!layout.examCode,
      // SBD chỉ đọc ở bản chính thức (lượt probe bỏ — tiết kiệm thêm)
      readStudentCode: !opts.probeOnly && opts.form.useStudentCode && !!layout.studentCode,
      strict: false,
      gridPairs: pairs,
      probeSkipP3: opts.probeOnly === true,
    });
    return { w, r, pairs, lay };
  };
  const decided = (r: SheetReadInternal) =>
    r.questions.filter((q) => q.answer >= 0).length + r.part3.flat().filter((d) => d >= 0).length;

  /**
   * Dựng layout đã DỊCH theo hàm offset từng nhóm lưới (vành ô in làm mốc):
   * giấy cong khi chụp làm độ lệch thay đổi theo từng phần (P1 −10px, P3 −2px…),
   * một warp đơn không đủ. Dịch toạ độ bubble trong layout để toàn bộ luồng đọc
   * (snap, dò hàng, khối chữ số, ô dấu) dùng đúng vị trí thực.
   */
  const shiftLayoutForRead = (
    lay: SheetLayout,
    f: (x: number, y: number) => { dx: number; dy: number },
    w: GrayMat,
  ): SheetLayout => {
    const sh = (b: { x: number; y: number; r: number }) => {
      const o = f(b.x * w.width, b.y * w.height);
      return { x: b.x + o.dx / w.width, y: b.y + o.dy / w.height, r: b.r };
    };
    // MÃ ĐỀ / SBD giữ nguyên toạ độ: lưới nhỏ nằm sát marker góc (warp chuẩn),
    // dịch theo nội suy dễ làm mất chữ số (418 → 018). Refine từng cột của
    // readDigitBlock tự xử lý phần lệch nhỏ còn lại.
    return {
      ...lay,
      questions: lay.questions.map((q) => ({ ...q, bubbles: q.bubbles.map(sh) })),
      part3: lay.part3.map((q) => ({
        ...q,
        columns: q.columns.map((c) => ({ ...c, bubbles: c.bubbles.map(sh) })),
        signs: q.signs
          ? { neg: sh(q.signs.neg), comma1: sh(q.signs.comma1), comma2: sh(q.signs.comma2) }
          : undefined,
      })),
      examCode: lay.examCode,
      studentCode: lay.studentCode,
    };
  };

  /**
   * Hiệu chỉnh lưới theo đáp án (grid fit) — 2 lớp:
   *  1. fitGridByProfile: đối chiếu profile mực PHẦN I với lưới chuẩn, sửa cả
   *     độ lệch LỚN (ảnh cắt mất mép trên / paper quad sai mép).
   *  2. fitGridCorrection: cặp (chuẩn → snap thực) tinh chỉnh affine phần dư.
   * Mỗi lớp chỉ nhận khi số ô đọc được không giảm; phần trang bị cắt thành nền
   * trắng nên preview dãn đúng tỷ lệ trang in, bubble khớp lưới đáp án.
   */
  // Đọc một lần duy nhất qua warpRead (warp + read + thu cặp hiệu chỉnh) —
  // mỗi lần warp+read tốn CPU đáng kể, không lặp lại cho cùng toạ độ.
  let current = warpRead(dstQuad);
  let currentDst = dstQuad;

  // Lớp 0 — hiệu chỉnh theo NHÓM lưới (vành ô in làm mốc): vành ô in sẵn trên
  // giấy là vị trí lưới THẬT, không phụ thuộc ô đã tô. Lưới đã khớp (vành nằm
  // đúng tâm ≥ 0.5) thì bỏ qua — đỡ tốn CPU cho ảnh chuẩn. Chấp nhận theo ĐỘ
  // KHỚP VÀNH: lưới lệch thì vành rơi khỏi hộp mẫu, số ô đọc được chỉ là điều
  // kiện phụ (dịch lưới sai có thể "đọc thêm" ô ma trên nền mực).
  try {
    if (opts.probeOnly) throw new Error("probe"); // bỏ hiệu chỉnh khi đọc thử
    const inkForFit = inkMap(current.w);
    const ringBefore = ringAlignmentScore(current.w, current.lay, inkForFit);
    if (ringBefore < 0.55) {
      const shifter = estimateSectionShifts(current.w, layout, inkForFit);
      if (shifter) {
        const shiftedLayout = shiftLayoutForRead(layout, shifter, current.w);
        const shifted = warpRead(dstQuad, shiftedLayout);
        const ringAfter = ringAlignmentScore(shifted.w, shiftedLayout, inkForFit);
        if (ringAfter >= ringBefore + 0.015 && decided(shifted.r) >= decided(current.r) * 0.9) {
          current = shifted;
        }
      }
    }
  } catch {
    // hiệu chỉnh nhóm lỗi (ảnh quá tối…) — giữ kết quả đọc chuẩn
  }

  // Hiệu chỉnh lưới khi khung warp KHÔNG hoàn toàn tin cậy: paper quad (mép
  // giấy cắt mất/bóng tối) hoặc khung marker có góc DỰ ĐOÁN affine (marker
  // thật bị mất). Marker đủ 4 góc xác nhận thì toạ độ chuẩn đúng sẵn — hiệu
  // chỉnh thêm chỉ làm hỏng khối chữ số nhỏ (SBD/Mã đề).
  const needGridFit = !!detect.quadIsPaper || !!detect.quadApprox;

  /** Đo "bubble khớp lưới": mực tại vị trí chuẩn của mỗi ô ĐÃ ĐỌC. */
  const gridInk = (w: GrayMat, r: SheetReadInternal, lay: SheetLayout = layout): number => {
    const ink = inkMap(w);
    let onGrid = 0;
    let total = 0;
    for (const q of r.questions) {
      if (q.answer < 0) continue;
      const b = lay.questions[q.index]?.bubbles[q.answer];
      if (!b) continue;
      total++;
      const cx = Math.round(b.x * w.width);
      const cy = Math.round(b.y * w.height);
      const rr = Math.max(2, Math.round(b.r * Math.min(w.width, w.height) * 0.6));
      let dark = 0;
      for (let y = Math.max(0, cy - rr); y <= Math.min(w.height - 1, cy + rr); y++) {
        for (let x = Math.max(0, cx - rr); x <= Math.min(w.width - 1, cx + rr); x++) {
          if (ink.data[y * w.width + x] !== 0) dark++;
        }
      }
      if (dark >= (2 * rr * 2 * rr) * 0.25) onGrid++;
    }
    return total > 0 ? onGrid / total : 0;
  };

  const tryCorrection = (corr: ReturnType<typeof fitGridCorrection> | null) => {
    if (!needGridFit || !corr) return false;
    const dst2: [Pt, Pt, Pt, Pt] = [
      corr.applyInverse(currentDst[0]),
      corr.applyInverse(currentDst[1]),
      corr.applyInverse(currentDst[2]),
      corr.applyInverse(currentDst[3]),
    ];
    const next = warpRead(dst2, current.lay);
    // Chấp nhận khi các bubble đã tô KHỚP lưới chuẩn hơn (tiêu chí trực tiếp
    // của bài toán) và không mất ô đọc được.
    // Đo trên LAYOUT ĐANG DÙNG: sau band-shift, toạ độ đọc là của current.lay —
    // đo bằng layout gốc sẽ khiến bản đọc đã dịch đúng trông như "lệch lưới".
    const metricNext = gridInk(next.w, next.r, current.lay);
    const metricCurrent = gridInk(current.w, current.r, current.lay);
    // Nhận khi lưới khớp rõ ràng hơn. Số ô đọc được có thể giảm nhẹ trên ảnh
    // cắt nặng (đánh đổi với preview đúng tỷ lệ trang in), nhưng không quá 25%.
    if (metricNext < metricCurrent + 0.02 || decided(next.r) < decided(current.r) * 0.75) return false;
    current = next;
    currentDst = dst2;
    return true;
  };

  if (!opts.probeOnly) {
    // Fit theo lưới ĐANG DÙNG (current.lay), không phải lưới gốc — nếu không
    // lớp này kéo ảnh về lưới gốc trong khi vẫn đọc bằng lưới đã dịch (shift
    // gấp đôi).
    tryCorrection(fitGridByProfile(current.w, current.lay));
    tryCorrection(fitGridCorrection(current.pairs, CAN, canonicalHeight));

    // Lớp 3 — NEO NHÃN SỐ CÂU: lưới dịch NGUYÊN MỘT HÀNG vẫn khớp vành ô in
    // (lưới đều) nên các lớp trên không phân biệt được — tái hiện thật trên
    // phiếu Giấy 10-11: block 2 PHẦN I bị kéo lên 1 hàng, câu 12 đọc ô của
    // câu 11… chấm sai cả lo. Nhãn số câu in trái cột A là mốc tuyệt đối
    // (mỗi nhãn = một câu, đếm được) — dùng để kéo block về đúng hàng.
    try {
      const fixedLay = alignP1BlocksByLabels(current.w, current.lay);
      if (fixedLay) {
        const fixed = warpRead(dstQuad, fixedLay);
        /**
         * CỔNG KIỂM CHỨNG BẮT BUỘC: lưới đều làm vành ô in không phân biệt
         * hàng, nên nếu ảnh KHÔNG có nhãn số câu (hoặc nhãn lẫn nhiễu) thì neo
         * nhãn có thể "sửa" một block đang ĐÚNG — hậu quả nặng hơn không sửa.
         * Đo hai bằng chứng ĐỘC LẬP với nhãn:
         *  1. điểm khớp vành toàn trang không được giảm;
         *  2. số ô đọc được không giảm mạnh (>10%).
         * Chỉ nhận khi cả hai đạt — sai một là giữ nguyên bản đọc cũ.
         */
        const rBefore = ringAlignmentScore(current.w, current.lay);
        const rAfter = ringAlignmentScore(fixed.w, fixedLay);
        if (rAfter >= rBefore - 0.01 && decided(fixed.r) >= decided(current.r) * 0.9) {
          current = fixed;
        }
      }
    } catch {
      // neo nhãn lỗi (ảnh quá tối…) — giữ kết quả đã đọc
    }
  }

  const warped = current.w;
  const read = current.r;

  // Full answer vector: PHẦN I + PHẦN II choice answers, PHẦN III digits,
  // rồi các Ô DẤU (− / dấu thập phân) của PHẦN III — mỗi câu có dấu 2 ô:
  // [ô −: 0 = tô, -1 trống][ô dấu thập phân: 0 sau số 1, 1 sau số 2, -1 trống].
  const signCells = (read.part3Signs ?? []).flatMap((s) =>
    s ? [s.neg ? 0 : -1, s.comma >= 0 ? s.comma : -1] : [],
  );
  const answers = [...read.questions.map((q) => q.answer), ...read.part3.flat(), ...signCells];

  // Đọc thử (so sánh mẫu giấy): KHÔNG dựng preview — mỗi lượt annotate tốn
  // grayToRgba + vẽ toàn bộ vòng/chữ trên ảnh 1400px, nhân với 4 mẫu là rất phí.
  if (opts.probeOnly) {
    return {
      ok: true,
      canonical: warped,
      markers: detect.quad,
      markersConfirmed: !detect.quadIsPaper,
      sharpness: detect.sharpness,
      answers,
      questions: read.questions,
      part3: read.part3,
      part3Signs: read.part3Signs,
      examCode: read.examCode,
      studentCode: read.studentCode,
      readError: read.readError,
      layout: current.lay,
      canonicalSize: { width: warped.width, height: warped.height },
    };
  }

  /**
   * ẢNH PREVIEW = ẢNH GỐC (không warp). Chỉ lưới đáp án được chiếu lên ảnh
   * chụp, đúng yêu cầu "giữ nguyên ảnh chấm, dời lưới cho khớp mốc/bubble".
   *
   * Chuỗi biến đổi: canonical (không gian bộ đọc) → ảnh gốc. `currentDst` là
   * quad canonical ĐÃ QUA mọi hiệu chỉnh (band shift, grid fit) dùng cho lần
   * warp cuối, nên homography currentDst → detect.quad chính là nghịch đảo của
   * phép warp đã dùng để đọc → lưới rơi đúng ô in trên ảnh gốc.
   */
  const PREVIEW_MAX_SIDE = 1400;
  const srcScale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(gray.width, gray.height));
  const pvW = Math.max(1, Math.round(gray.width * srcScale));
  const pvH = Math.max(1, Math.round(gray.height * srcScale));
  const previewSrc = srcScale < 1 ? resizeMat(gray, pvW, pvH) : gray;
  const back = quadPointMapper(currentDst, detect.quad!);
  const toSource = back
    ? (p: Pt) => {
        const q = back(p);
        return { x: q.x * srcScale, y: q.y * srcScale };
      }
    : undefined;

  // Vẽ lưới lên ẢNH GỐC: không gian chuẩn = canonical (nơi layout được tính),
  // `mapPoint` chiếu về ảnh chụp. Nhờ vậy preview giữ nguyên hình upload.
  const preview = annotateSheet(
    grayToRgba(previewSrc),
    previewSrc.width,
    previewSrc.height,
    current.lay,
    read.questions,
    opts.keyAnswers ?? null,
    null,
    read.part3,
    read.examCode,
    read.studentCode,
    read.part3Signs,
    { width: warped.width, height: warped.height, mapPoint: toSource },
  );

  return {
    ok: true,
    canonical: warped,
    preview: { width: previewSrc.width, height: previewSrc.height, rgba: preview },
    markers: detect.quad,
    markersConfirmed: !detect.quadIsPaper,
    sharpness: detect.sharpness,
    answers,
    questions: read.questions,
    part3: read.part3,
    part3Signs: read.part3Signs,
    examCode: read.examCode,
    studentCode: read.studentCode,
    readError: read.readError,
    layout: current.lay,
    toSource,
    source: previewSrc,
    canonicalSize: { width: warped.width, height: warped.height },
  };
}

/**
 * Cheap pass for the live overlay loop: marker detection only (no warp/read).
 * Returns the paper quad in image coordinates so the UI can draw the frame.
 */
export function probeGray(
  gray: { width: number; height: number; data: Uint8ClampedArray },
  opts: {
    checkSharpness?: boolean;
    markerFractions?: [MarkerAnchor, MarkerAnchor, MarkerAnchor, MarkerAnchor];
  } = {},
): {
  ok: boolean;
  stage: "searching" | "low-sharpness" | "no-markers" | "aligned";
  message?: string;
  markers?: Pt[];
  sharpness: number;
  quad?: [Pt, Pt, Pt, Pt];
} {
  const detect = detectCornerMarkers(gray, {
    checkSharpness: opts.checkSharpness !== false,
    markerFractions: opts.markerFractions,
  });
  if (!detect.ok || !detect.quad) {
    return {
      ok: false,
      stage: detect.message?.startsWith("Ảnh mờ") ? "low-sharpness" : "no-markers",
      message: detect.message,
      markers: detect.markers.map((m) => ({ x: m.cx, y: m.cy })),
      sharpness: detect.sharpness,
    };
  }
  return {
    ok: true,
    stage: "aligned",
    markers: detect.quad,
    sharpness: detect.sharpness,
    quad: detect.quad,
  };
}

/** Re-render the preview with a score string (after grading is known). */
export function renderScoredPreview(
  res: ProcessResult,
  scoreText: string | null,
  keyAnswers: number[] | null,
): { width: number; height: number; rgba: Uint8ClampedArray } | undefined {
  if (!res.questions) return res.preview;
  // Cùng quy ước với preview ban đầu: nền là ẢNH GỐC, lưới chiếu từ canonical.
  const base = res.source ?? res.canonical;
  if (!base) return res.preview;
  const annotated = annotateSheet(
    grayToRgba(base),
    base.width,
    base.height,
    res.layout,
    res.questions,
    keyAnswers,
    scoreText,
    res.part3,
    res.examCode,
    res.studentCode,
    res.part3Signs,
    res.canonicalSize
      ? { width: res.canonicalSize.width, height: res.canonicalSize.height, mapPoint: res.toSource }
      : undefined,
  );
  return { width: base.width, height: base.height, rgba: annotated };
}

/**
 * ĐỌC PHIẾU VỚI BƯỚC CẮT THEO KHUNG ĐỎ CỦA MẪU.
 *
 * Quy trình (dùng cho ảnh UPLOAD):
 *  1. `planCrop` tìm 4 mốc vuông đen in trên phiếu → homography → 4 góc khung
 *     đỏ trong ảnh chụp (tự xử lý cả ảnh nghiêng lẫn phối cảnh).
 *     Không đủ mốc → ước lượng góc nghiêng từ đường kẻ ngang in sẵn, xoay
 *     thẳng rồi cắt theo tỉ lệ khung của mẫu.
 *  2. `applyCrop` warp ảnh gốc về đúng khung đó.
 *  3. Chấm trên ẢNH ĐÃ CẮT với layout đã quy đổi (`rescaleLayout`) — bộ đọc
 *     giữ nguyên, chỉ đổi hệ toạ độ.
 *
 * Mẫu không khai báo `cropBox` (vd Giấy 12) → chấm như cũ, không cắt.
 */
export function processGrayWithCrop(
  gray: GrayMat,
  opts: ProcessOptions & { cropTargetWidth?: number },
): FormDetectResult & {
  sheetQuad?: [Pt, Pt, Pt, Pt];
  /** Góc xoay tiền xử lý (độ) — 0 nếu ảnh vốn thẳng. */
  prepSkewDeg?: number;
  /** Tiền xử lý có cắt dải đen/viền hay không. */
  prepTrimmed?: boolean;
} {
  const base = opts.layoutOverride ?? canonicalSheet(opts.form);
  // Flat-flow áp cho MỌI mẫu upload (trước đây chỉ mẫu có cropBox — Giấy 10-11
  // — khiến QM_A4/GIAY12 upload đi đường cũ: không flatten, không sheetQuad,
  // scan nhạt đọc hỏng Mã đề/SBD — đo 12 trang Tin 12 2026-11-17). Webcam
  // (không cropToBox) giữ đường cũ như trước.
  if (!opts.cropToBox) return processWithFormDetection(gray, opts.form, opts);

  /**
   * LUỒNG NHANH cho ảnh upload (mẫu có cropBox):
   *  1. thu nhỏ ≤1800px (chấm + probe đều đủ ở độ phân giải này);
   *  2. CÂN BẰNG SÁNG CỤC BỘ — sửa vùng tối (mã đề/đáp án) do bóng đổ;
   *  3. dò 4 MỐC VUÔNG bằng blob (tin cậy hơn detectCornerMarkers trên ảnh
   *     chụp thật — 5/5 ảnh 11a8) → `sheetQuad`;
   *  4. chấm + dò mẫu trên ảnh phẳng, MỌI probe warp CÙNG sheetQuad → điểm
   *     vành so sánh công bằng, mẫu thật thắng (không bị đổi sang MOI oan);
   *  5. trả `sheetQuad` — worker dùng để XOAY THẲNG + CẮT ảnh preview.
   * Đọc luôn trên TOÀN ảnh phẳng (không cắt trước khi đọc).
   */
  const scale = Math.min(1, 1800 / Math.max(gray.width, gray.height));
  const small = scale < 1 ? resizeMat(gray, Math.round(gray.width * scale), Math.round(gray.height * scale)) : gray;
  /**
   * TIỀN XỬ LÝ ẢNH (yêu cầu 2026-11-17 — ảnh bị sai khi tiền xử lý):
   *  1. `trimBlackBands` — cắt dải đen/viền khung ở 4 mép. Đo ảnh lỗi: dải
   *     1500×22 phủ hết chiều rộng tại y=11 và y=2105 → blob detector bắt nhầm
   *     làm "mốc góc" → warp cả trang sai (tỉ lệ quad 1.03 thay vì 1.40).
   *  2. `ensureMargins` — đệm lề trắng nếu mực chạm mép (crop sát giấy).
   *  3. `autoDeskew` — quét góc ±6° chọn profile hàng sắc nhất; chỉ nhận khi
   *     tăng ≥8% (ảnh vốn thẳng không bị xoay). Đo ảnh lỗi A/B: nghiêng
   *     −0.75°/+0.50° → lệch vành 10px ở cuối trang (P1 câu 2/5) dù đầu trang
   *     khớp. Xoay xong lệch còn 0.05°.
   * Chạy trên ảnh ≤1800px: 0.33–0.36s/ảnh. Trả `skewDeg`/`trimmed` cho UI.
   */
  const pre = preprocessUpload(small);
  const prepped = pre.image;
  // CÂN BẰNG SÁNG HAI LƯỢT: lượt 1 sửa nền/khung tối (bóng đổ); scan
  // photocopy NHẠT (mực in mờ, nền xám — đo 12 trang scan Tin 12: 4 trang đọc
  // hỏng Mã đề/SBD "18"/"315"/"4268") cần lượt 2 để độ tương phản cục bộ còn
  // lại nổi hẳn mực lên khỏi nền. Đo: 4 trang hỏng → đọc đúng MĐ/SBD sau lượt
  // 2; trang tốt không đổi kết quả.
  const flat = flattenIllumination(flattenIllumination(prepped));
  // Blob quad — kiểm chứng CHÉO bằng dò mốc theo MẪU KHAI BÁO: hai phương pháp
  // phải khớp nhau trong ~2% đường chéo. Scan crop lệch (trang 39 file 81
  // trang) làm blob dò nhầm nội dung thành tứ giác sai — lệch hẳn dò theo mẫu
  // → BỎ quad, để probe từng mẫu tự dò (detectCornerMarkers) thay vì warp cả
  // luồng bằng tứ giác sai. Ảnh chụp thật: hai quad khớp 0.0–0.1% → giữ.
  let sheetQuad = pickCornerMarkersForCrop(flat) ?? undefined;
  // CỔNG TỈ LỆ TỨ GIÁC: mốc in của mẫu tạo tứ giác có tỉ lệ cao/rộng CỐ ĐỊNH
  // (Giấy 10-11 ≈ 1.41). Tỉ lệ lệch >12% nghĩa là đã bắt nhầm blob (đo ảnh C:
  // 1.03; trang-73 của file 81 trang: 1.23). Quad bị loại thì THỬ quad của
  // `detectCornerMarkers` (nếu nó dò được mốc thật, không phải mép giấy) —
  // đo trang-73: detect cho quad kín trang (28,52)…(1246,1759) đúng mẫu.
  const mkBase = base.markers;
  const expectAspect = mkBase
    ? ((mkBase.bl.y - mkBase.tl.y) * base.height) / ((mkBase.tr.x - mkBase.tl.x) * base.width)
    : base.height / base.width;
  const quadAspectOk = (q: [Pt, Pt, Pt, Pt]) => {
    const wSpan = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const hSpan = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const aspect = wSpan > 0 ? hSpan / wSpan : 0;
    return expectAspect > 0 && Math.abs(aspect / expectAspect - 1) <= 0.12;
  };
  if (sheetQuad && !quadAspectOk(sheetQuad)) {
    const detFallback = detectCornerMarkers(flat, {
      checkSharpness: false,
      markerFractions: [base.markers.tl, base.markers.tr, base.markers.br, base.markers.bl],
      pageAspect: base.width / base.height,
    });
    sheetQuad =
      detFallback.ok && detFallback.quad && !detFallback.quadApprox && !detFallback.quadIsPaper && quadAspectOk(detFallback.quad)
        ? detFallback.quad
        : undefined;
  }
  if (sheetQuad) {
    const det = detectCornerMarkers(flat, {
      checkSharpness: false,
      markerFractions: [base.markers.tl, base.markers.tr, base.markers.br, base.markers.bl],
      pageAspect: base.width / base.height,
    });
    /**
     * CHỈ dùng detectCornerMarkers làm trọng tài khi nó dò được ĐÚNG vị trí
     * mốc của mẫu (`!quadApprox` — không phải góc dự đoán affine, cũng không
     * phải mép giấy). Đo H5: detect dò SAI top-right ở y=65 (mốc thật y=369)
     * — lệch 147px → trước đây nó LOẠI blob quad ĐÚNG, pipeline rơi về tự dò
     * của probe → mẫu bị đổi oan sang MOI. Blob quad của
     * `pickCornerMarkersForCrop` (đúng 4 ô vuông đặc DUY NHẤT trên phiếu) là
     * nguồn tin cậy hơn; detect chỉ được phép bác khi nó chắc chắn.
     */
    if (det.ok && det.quad && !det.quadApprox && !det.quadIsPaper) {
      const diag = Math.hypot(flat.width, flat.height);
      const meanD =
        [0, 1, 2, 3].reduce(
          (a, i) => a + Math.hypot(sheetQuad![i].x - det.quad![i].x, sheetQuad![i].y - det.quad![i].y),
          0,
        ) / 4;
      if (meanD > diag * 0.02) sheetQuad = undefined;
    }
  }
  const r = processWithFormDetection(flat, opts.form, {
    ...opts,
    layoutOverride: undefined,
    markerQuad: sheetQuad,
  });
  /**
   * FALLBACK KHI TIỀN XỬ LÝ LÀM HỎNG: nếu bản đã tiền xử lý KHÔNG khớp key
   * nào (mã đề đọc hỏng) mà bản GỐC lại đọc tốt hơn, dùng bản gốc. Đo trang
   * b-6 (Tin 12): tiền xử lý xoay 0.7° làm MĐ đọc thành "24" (không khớp)
   * trong khi ảnh gốc cùng đường đọc cho kết quả tốt hơn — thà trả bản gốc.
   * Cổng: chỉ thử lại khi (a) có keys, (b) bản tiền xử lý không khớp key, và
   * (c) bản gốc đọc được mã dài hơn/khớp key.
   */
  let chosen = r;
  let chosenFlat = flat;
  let chosenQuad = sheetQuad;
  if (opts.keys?.length && !codeMatchesKeys(r.examCode, opts.keys)) {
    const flatRaw = flattenIllumination(flattenIllumination(small));
    const quadRaw = pickCornerMarkersForCrop(flatRaw) ?? undefined;
    const rRaw = processWithFormDetection(flatRaw, opts.form, {
      ...opts,
      layoutOverride: undefined,
      markerQuad: quadRaw,
    });
    if (codeMatchesKeys(rRaw.examCode, opts.keys)) {
      chosen = rRaw;
      chosenFlat = flatRaw;
      chosenQuad = quadRaw;
    }
  }
  // sheetQuad đo trên ảnh PHẲNG (≤1800px) nhưng `source` trả về là bản thu nhỏ
  // riêng (≤1400px) — quy đổi về hệ `source` để worker warp preview đúng khung.
  let outQuad = chosenQuad;
  if (chosenQuad && chosen.source && chosen.source.width !== chosenFlat.width) {
    const k = chosen.source.width / chosenFlat.width;
    outQuad = chosenQuad.map((p) => ({ x: p.x * k, y: p.y * k })) as [Pt, Pt, Pt, Pt];
  }
  return { ...chosen, sheetQuad: outQuad, prepSkewDeg: pre.skewDeg, prepTrimmed: pre.trimmed };
}
