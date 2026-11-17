/**
 * Tự nhận diện MẪU GIẤY của ảnh chụp (QM_A4 / Giấy 12 / Giấy 10-11 / Mới 2025)
 * rồi đọc bằng đúng layout của mẫu đó.
 *
 * Vì sao cần: bốn mẫu dùng chung không gian marker nhưng lưới đáp án khác nhau.
 * Đọc sai mẫu → lưới đáp án lệch so với hình upload (vòng khoanh không nằm trên
 * ô in) và điểm sai. Trước đây chỉ có fallback QM_A4 ↔ Giấy 10-11.
 *
 * Chỉ số chọn mẫu: độ khớp VÀNH Ô IN trung bình toàn trang (ringAlignmentScore —
 * vành in là mốc tuyệt đối, không phụ thuộc ô đã tô) × tỉ lệ ô đọc được, ĐIỂM
 * THUẦN (không cộng bonus mã đề). Mã đề khớp key chỉ là TÍN HIỆU PHỤ khi vành
 * không phân biệt được: MOI và Giấy 10-11 có khối mã đề gần trùng nhau trong
 * không gian chuẩn nên CẢ HAI lưới đều đọc được "mã khớp" — cộng bonus mã đề
 * vào điểm sẽ khoá cứng mẫu sai (đã tái hiện trên fixtures).
 */

import type { FormConfig, FormKind, GrayMat, Pt, SheetLayout } from "./types";
import { GIAY_FORMS } from "./types";
import { processGray, type ProcessResult } from "./pipeline";
import { inkMap } from "./reader";
import { ringAlignmentScore } from "./grid-fit";
import { inferCodeFromAnswers, type KeyLike } from "./code-infer";

/** Số ô đáp án mặc định của từng mẫu (dùng khi cần dựng FormConfig tạm). */
export const FORM_ANS: Partial<Record<FormKind, number>> = {
  QM_A4: 108,
  GIAY12: 108,
  GIAY10_11: 130,
  MOI: 68,
};

/** Bốn mẫu dùng chung (bỏ các mẫu cũ A4/A6/A8 không còn dùng). */
export const ALL_FORMS: FormKind[] = GIAY_FORMS;

/**
 * Mã đề đọc được có khớp đáp án chuẩn? ≥3 ký tự; đuôi chỉ so khi lệch đúng 1
 * ký tự (1132 ↔ 132) — tránh trùng đuôi ngẫu nhiên.
 */
export function codeMatchesKeys(code: string | null | undefined, keys?: { code: string }[] | null): boolean {
  const c = (code ?? "").trim();
  if (!Array.isArray(keys) || !keys.length || c.length < 3) return false;
  return keys.some((k) => {
    if (k.code === c) return true;
    if (k.code.length > c.length) return k.code.endsWith(c) && k.code.length - c.length === 1;
    if (c.length > k.code.length) return c.endsWith(k.code) && c.length - k.code.length === 1;
    return false;
  });
}

/**
 * Điểm chất lượng đọc THUẦN: khớp vành ô in × tỉ lệ ô đọc được — KHÔNG cộng
 * bonus mã đề. Lý do: tín hiệu vành đo được chỉ 0.02–0.28, bonus +0.25 tương
 * đương 1.6–12× tín hiệu nên chiếm ưu thế tuyệt đối trong mọi phép so sánh,
 * làm các ngưỡng (GOOD_QUALITY, margin) trở nên vô nghĩa.
 */
export function readQuality(res: ProcessResult): number {
  if (!res.ok || !res.canonical) return -1;
  const ink = inkMap(res.canonical);
  const ring = ringAlignmentScore(res.canonical, res.layout, ink);
  const ans = res.answers ?? [];
  if (!ans.length) return -1;
  const decided = ans.filter((a) => a >= 0).length / ans.length;
  return ring * decided;
}

/**
 * Điểm vành THUẦN (không nhân tỉ lệ ô đã đọc) — dùng riêng để phân biệt CẶP
 * SONG SINH MOI↔Giấy 10-11. Lý do: hai lưới có SỐ Ô RẤT KHÁC NHAU (Giấy 10-11
 * ~130 ô với P2 Đ/S + P3, MOI ~36 ô) nên cùng một lớp mực học sinh cho tỉ lệ
 * decided hoàn toàn khác (đo ảnh thật: Giấy 28/130 = 0.215, MOI 28/36 = 0.78
 * — mực tràn vào vị trí lấy mẫu của lưới sai làm decided PHÌNH TO). Nhân decided
 * vào điểm (readQuality) làm lưới SAI thắng lưới THẬT 3.4× dù điểm vành thuần
 * HOÀN TOÀN HOÀ (0.302 vs 0.283). Điểm vành thuần mới là tín hiệu hình học —
 * khoảng cách thực đo trên fixtures cặp này 1.22–1.29×.
 */
export function readRing(res: ProcessResult): number {
  if (!res.ok || !res.canonical) return -1;
  return ringAlignmentScore(res.canonical, res.layout, inkMap(res.canonical));
}

/**
 * Ngưỡng coi như "đọc tốt" — đủ cao để giữ mẫu khai báo khi mã đề khớp, đủ thấp
 * để ảnh mờ nhẹ vẫn không bị đổi mẫu oan. Đo trên ảnh thật: mẫu đúng ~0.14–0.17,
 * mẫu sai ~0.02–0.08.
 */
export const GOOD_QUALITY = 0.1;

/**
 * Khớp mã đề đọc được với danh sách key. Thứ tự ưu tiên:
 *  1. mã đọc được nguyên văn (3 hoặc 4 số — biến thể Giấy 12 tô đủ 4 cột);
 *  2. đuôi 3 số ("2109" ↔ key "109"; phiếu 3 cột tô 3 số bên phải của mã 4 số
 *     "1132" ↔ key "132") — chỉ áp khi lệch đúng 1 ký tự để tránh trùng đuôi
 *     ngẫu nhiên.
 * Trả về undefined khi không khớp — nơi gọi quyết định fallback (single-key
 * khi phiếu không có lưới mã đề, hoặc suy ngược từ lưới đáp án).
 */
export function matchKeyByCode(
  rawCode: string | null | undefined,
  keys?: { code: string; answers: number[] }[] | null,
): { code: string; answers: number[] } | undefined {
  const raw = (rawCode ?? "").trim();
  if (!raw || !Array.isArray(keys) || !keys.length) return undefined;
  const code = raw.length > 4 ? raw.slice(-4) : raw;
  const code3 = raw.length >= 3 ? raw.slice(-3) : raw.padStart(3, "0");
  const exact =
    keys.find((k) => k.code === code) ??
    (code3 !== code ? keys.find((k) => k.code === code3) : undefined) ??
    keys.find((k) => k.code.endsWith(code3) || code3.endsWith(k.code));
  if (exact) return exact;
  // Scan nhạt làm MẤT MỘT CHỮ SỐ của lưới mã đề (đo Tin 12: "3157" đọc thành
  // "315" — mất cột cuối): khớp theo TIỀN TỐ/HẬU TỐ nhưng chỉ nhận khi DUY
  // NHẤT một mã khớp — hai mã cùng khớp là bỏ (thà không chấm còn hơn gán sai).
  const cands = keys.filter(
    (k) => (k.code.startsWith(raw) || raw.startsWith(k.code)) && raw.length >= 3 && k.code.length >= 3,
  );
  return cands.length === 1 ? cands[0] : undefined;
}

export interface FormDetectResult extends ProcessResult {
  /** Mẫu giấy thực sự đã dùng để đọc. */
  formUsed: FormKind;
  /** Mẫu đổi so với khai báo (để UI biết). */
  formSwitched: boolean;
  quality: number;
}

/**
 * Cặp mẫu nguy hiểm: MOI ↔ Giấy 10-11 có khối mã đề gần trùng nhau trong không
 * gian chuẩn — CẢ HAI lưới đều đọc được CÙNG mã đề (đo trên fixtures: MOI đọc
 * phiếu Giấy 10-11 ra đúng mã 745 của phiếu, điểm vành 0.230–0.306 so với mẫu
 * thật 0.280–0.547). Với cặp này, "mã đề khớp key" KHÔNG phải bằng chứng chọn
 * mẫu — chỉ khoảng cách điểm vành thuần phân biệt được (margin 1.22–1.29×).
 */
const TWIN_PAIR: Record<string, FormKind> = {
  MOI: "GIAY10_11",
  GIAY10_11: "MOI",
  // QM_A4 ↔ Giấy 12: hai mẫu CÙNG thiết kế "PHIẾU TRẢ LỜI TRẮC NGHIỆM"
  // (P1 40 câu 4 cột, khối SBD 8 số + Mã đề 4 số góc trên-phải) — lưới của
  // mẫu kia chồng khớp gần hết lên phiếu của mẫu này. Đo 12 trang scan Tin 12
  // (2026-11-17): khai báo QM_A4, scan tối → QM_A4 pure tụt ~0.02-0.05 trong
  // khi GIAY12 giữ ~0.14-0.28 → app ĐỔI SANG GIAY12 cả 12/12 trang → SBD/Mã đề
  // đọc bằng lưới GIAY12 lệch vị trí ("18", "315", "4268", SBD "−0120222") →
  // mất key / chấm sai. Với cặp này mã khớp key KHÔNG phải bằng chứng — trọng
  // tài keyRatio (xem KEY_MARGIN) quyết định.
  QM_A4: "GIAY12",
  GIAY12: "QM_A4",
};

/**
 * Tỉ lệ điểm vành thuần tối thiểu để ĐỔI mẫu so với mẫu khai báo. Đo trên
 * fixtures: cặp nguy hiểm MOI↔Giấy 10-11 cách nhau 1.22–1.29×; các cặp khác
 * cách 1.8–7×. Ngưỡng 1.15 giữ lại được ca khó nhất mà vẫn không đổi oan
 * (khi mẫu khai báo đúng, mẫu khó nhất cũng chỉ đạt 0.55–0.82× mẫu khai báo).
 */
const SWITCH_MARGIN = 1.15;

/**
 * Chênh lệch tỉ lệ khớp key tối thiểu để trọng tài key phân biệt cặp song sinh
 * (MOI↔Giấy 10-11). Đo 5 ảnh thật 11a8: lưới thật 86–100%, lưới song sinh
 * 78–89% — luôn chênh ≥7 điểm phần trăm → ngưỡng 5% an toàn.
 */
const KEY_MARGIN = 0.05;

/**
 * Đọc phiếu với tự nhận diện mẫu. `forms` giới hạn danh sách mẫu thử (mặc định
 * cả 4). Toàn bộ probe chạy ở ẢNH GỐC (không thu nhỏ): ở 1400px lưới MOI đọc
 * yếu hẳn (bong bóng nhỏ — đo scan-moi: MOI 0.153 ở ảnh gốc nhưng 0.057 ở
 * 1400px, thấp hơn cả điểm của lưới sai) nên so sánh ở đó sẽ chọn sai mẫu.
 */
export function processWithFormDetection(
  gray: GrayMat,
  form: FormConfig,
  opts: {
    checkSharpness?: boolean;
    forms?: FormKind[];
    keys?: KeyLike[] | null;
    /** Layout override (ảnh đã cắt dùng layout đã rescale). */
    layoutOverride?: SheetLayout;
    /**
     * Quad 4 mốc dò TRƯỚC bằng blob (pickCornerMarkersForCrop) — truyền cho
     * CẢ probe lẫn đọc cuối: mọi mẫu đều warp CÙNG một vùng vật lý nên điểm
     * vành so sánh công bằng (mẫu thật thắng). Không có thì mỗi probe tự dò
     * mốc theo markerFractions của MỪNG mẫu — trên ảnh chụp tối, mốc in trong
     * thân phiếu (Giấy 10-11) thất bại → fallback mép giấy → lưới méo → mẫu
     * thật bị điểm vành thấp hơn cả lưới sai (MOI) và bị đổi mẫu oan.
     */
    markerQuad?: [Pt, Pt, Pt, Pt];
  } = {},
): FormDetectResult {
  const keys = opts.keys ?? null;
  const probeOf = new Map<FormKind, ProcessResult>();
  const run = (f: FormKind, probeOnly = false, preWarped?: GrayMat) => {
    const r = processGray(gray, {
      form: { ...form, form: f },
      checkSharpness: opts.checkSharpness ?? false,
      probeOnly,
      layoutOverride: probeOnly ? undefined : opts.layoutOverride,
      markerQuadOverride: opts.markerQuad,
      // Tái dùng ảnh warp của lượt probe CÙNG mẫu (quad đã ghim) — bỏ warp lại.
      preWarped: probeOnly ? undefined : preWarped,
    });
    if (probeOnly) probeOf.set(f, r);
    return r;
  };

  /**
   * TỈ LỆ KHỚP KEY của đáp án đọc được — trọng tài PHÂN BIỆT cặp song sinh khi
   * có key. Đo 5 ảnh thật 11a8: lưới thật khớp key 86–100%, lưới song sinh chỉ
   * 78–89% (hai lưới quá giống nhau nên lưới sai cũng đọc được phần lớn đáp án,
   * nhưng luôn kém lưới thật ≥7 điểm phần trăm) → lệch ≥5% là đủ tin. Trả null
   * khi không có key (rơi về so điểm vành); 0 khi có key nhưng không khớp mã nào.
   */
  const keyRatio = (r: ProcessResult | undefined): number | null => {
    if (!keys?.length || !r) return null;
    const g = inferCodeFromAnswers(r.answers ?? [], r.layout, keys, declared, form.ansNumber, -1);
    return g ? g.ratio : 0;
  };

  const codeHit = (r: ProcessResult) => codeMatchesKeys(r.examCode, keys);
  const pick = (
    list: { form: FormKind; pure: number; ring: number; hit: boolean }[],
    base: { form: FormKind; pure: number; ring: number; hit: boolean },
  ) => {
    let best = base;
    for (const c of list) {
      // Pure cao hơn thắng; hoà về pure (cách nhau < 20% tương đối) thì ưu tiên
      // mẫu có mã đề khớp key.
      if (c.pure > best.pure || (c.pure >= best.pure * 0.8 && c.hit && !best.hit)) best = c;
    }
    return best;
  };

  const declared = form.form as FormKind;
  const declaredProbe = run(declared, true);
  const declaredPure = readQuality(declaredProbe);
  const declaredHit = codeHit(declaredProbe);
  const twin = TWIN_PAIR[declared];
  // Điểm vành khai báo tính LƯỠI — chỉ cần khi trọng tài key không phân biệt
  // được (inkMap đã có đệm nên lần đầu ~0.3s, sau đó rẻ).
  let declaredRingCache: number | null = null;
  const ringOfDeclared = () => (declaredRingCache ??= readRing(declaredProbe));
  const declaredEntry = {
    form: declared,
    pure: declaredPure,
    get ring() {
      return ringOfDeclared();
    },
    hit: declaredHit,
  };

  /**
   * Trọng tài cặp song sinh: key khớp lệch ≥ KEY_MARGIN quyết định (bền với
   * ảnh tối/méo); hoà hoặc không có key → điểm vành thuần (margin chuẩn).
   */
  const twinWins = (twinProbe: ProcessResult): boolean => {
    const rd = keyRatio(declaredProbe);
    const rt = keyRatio(twinProbe);
    if (rd !== null && rt !== null && Math.abs(rd - rt) >= KEY_MARGIN) return rt > rd;
    return readRing(twinProbe) >= ringOfDeclared() * SWITCH_MARGIN;
  };

  // ===== ĐƯỜNG NHANH khi CÓ KEY và mã đọc được khớp key =====
  // Chỉ mẫu khai báo và song sinh của nó đọc được đúng mã (các mẫu khác đọc mã
  // rác — đo trên phiếu G1011: GIAY12 đọc "4", QM_A4 đọc "03", pure thấp hơn
  // khai báo nhiều lần) → KHÔNG probe các mẫu còn lại. Đo profile ảnh thật:
  // vòng candidates là 51% thời gian chấm (~5.1s/3 ảnh probe + readQuality) —
  // đường nhanh này hạ tổng thời gian xuống ~5s. Đọc chính thức tái dùng ảnh
  // warp của probe (`preWarped`) — cùng mẫu, cùng quad ghim.
  // ĐIỀU KIỆN AN TOÀN: cặp song sinh thì luôn được (trọng tài key phân xử);
  // mẫu KHÔNG song sinh phải đọc tốt (pure ≥ GOOD) — nếu chỉ "hơi đọc được"
  // (QM_A4 khai báo trên phiếu GIAY12 đọc đúng mã 2109 với pure ~0.02 — ca
  // biến thể 4 số) thì bắt buộc chạy vòng candidates để mẫu đúng thắng.
  if (
    keys &&
    keys.length &&
    declaredHit &&
    declaredPure > 0 &&
    (twin !== undefined || declaredPure >= GOOD_QUALITY)
  ) {
    if (!twin) {
      const final = run(declared, false, declaredProbe.canonical);
      return { ...final, formUsed: declared, formSwitched: false, quality: declaredPure };
    }
    const twinProbe = run(twin, true);
    if (!twinWins(twinProbe)) {
      const final = run(declared, false, declaredProbe.canonical);
      return { ...final, formUsed: declared, formSwitched: false, quality: declaredPure };
    }
    const final = run(twin, false, twinProbe.canonical);
    return { ...final, formUsed: twin, formSwitched: true, quality: readQuality(final) };
  }

  // Không có key (hoặc mã không khớp / đọc hỏng): so toàn bộ các mẫu như trước.
  const forms = opts.forms ?? ALL_FORMS;
  const candidates: { form: FormKind; pure: number; ring: number; hit: boolean }[] = [];
  for (const f of forms) {
    if (f === declared) continue;
    const r = run(f, true);
    candidates.push({ form: f, pure: readQuality(r), ring: readRing(r), hit: codeHit(r) });
  }

  let best = pick(candidates, declaredEntry);

  /**
   * Quyết định ĐỔI mẫu — điểm vành thuần là tín hiệu chính:
   *  - mẫu mới thắng RÕ (≥1.15× mẫu khai báo, và ≥ nửa ngưỡng đọc tốt);
   *  - hoặc cả hai đều đọc yếu (< GOOD_QUALITY) và CHỈ mẫu mới khớp mã đề —
   *    khi vành không phân biệt được (ảnh tối/méo), mã khớp key là bằng chứng
   *    còn lại.
   *
   * CẶP SONG SINH (MOI↔Giấy 10-11): so bằng điểm vành THUẦN (readRing), không
   * phải pure (= ring × decided). Hai lưới số ô chênh nhau ~4× nên cùng một
   * lớp mực cho decided khác hẳn (ảnh thật: 0.215 vs 0.78) — pure làm lưới
   * sai thắng lưới thật 3.4× (đo 5 ảnh 11a8). Điểm vành thuần của cặp này hoà
   * nhau (0.302 vs 0.283) → giữ mẫu khai báo, đúng như margin 1.22–1.29× đo
   * trên fixtures.
   */
  const okToSwitch =
    best.form !== declared &&
    best.pure > 0 &&
    (best.form === twin
      ? twinWins(probeOf.get(best.form)!)
      : (best.pure >= declaredPure * SWITCH_MARGIN && best.pure >= GOOD_QUALITY * 0.5) ||
        (declaredPure < GOOD_QUALITY && best.pure < GOOD_QUALITY && best.hit && !declaredHit));
  if (!okToSwitch) best = declaredEntry;

  // Đọc CHÍNH THỨC một lần trên ảnh gốc với mẫu đã chọn (tái dùng ảnh warp của
  // probe cùng mẫu nếu có — quad ghim nên cùng khung).
  const final = run(best.form, false, probeOf.get(best.form)?.canonical);
  return {
    ...final,
    formUsed: best.form,
    formSwitched: best.form !== declared,
    quality: best.form === declared ? best.pure : readQuality(final),
  };
}
