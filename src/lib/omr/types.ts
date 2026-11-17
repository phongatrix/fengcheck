/** Shared types for the OMR pipeline. */

export interface Pt {
  x: number;
  y: number;
}

export interface RectI {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GrayMat {
  readonly width: number;
  readonly height: number;
  /** Row-major, 0..255 */
  readonly data: Uint8ClampedArray;
}

export type FormKind =
  | "QM_A4"
  | "GIAY12"
  | "GIAY10_11"
  | "MOI"
  | "A4"
  | "A6"
  | "A8";

/** 2 mẫu giấy dùng chung của QM 2025 (geometry từ PDF vector). */
export const QM_FORMS: FormKind[] = ["QM_A4", "GIAY10_11"];

export const GIAY_FORMS: FormKind[] = [...QM_FORMS, "GIAY12", "MOI"];

export const FORM_LABELS: Record<FormKind, string> = {
  QM_A4: "QM 2025 - A4 (Ky kiểm tra)",
  GIAY12: "Giấy khối 12",
  GIAY10_11: "Giấy khối 10 - 11",
  MOI: "Mới 2025 (20 câu + 4 Đ/S + 8 số)",
  A4: "Tự thiết kế (A4)",
  A6: "Tự thiết kế (A6)",
  A8: "Tự thiết kế (A8)",
};

export interface FormConfig {
  /** Number of questions on the sheet (total, incl. Đ/S and digit columns). */
  ansNumber: number;
  /** Options per question (A..D by default; custom layouts only). */
  optionsPerQuestion: number;
  /** Sheet layout kind. */
  form: FormKind;
  /** 3-digit exam code block (mã đề). */
  useExamCode: boolean;
  /** 6-digit student code block (mã SV / số báo danh). */
  useStudentCode: boolean;
}

export interface Bubble {
  /** Center in canonical sheet coordinates. */
  x: number;
  y: number;
  /** Radius in canonical units (min-side units). */
  r: number;
}

export interface QuestionLayout {
  index: number;
  /** One entry per option (A..D, or Đúng/Sai). */
  bubbles: Bubble[];
}

export interface DigitColumnLayout {
  /** 10 bubbles, digit 0..9 from top to bottom. */
  bubbles: Bubble[];
}

/**
 * Dấu trừ và dấu thập phân in phía trên cột chữ số (các mẫu QM 2025 / Giấy):
 *   neg    — 1 ô dấu "−" (cùng x cột số 1, cao hơn 2 bước hàng)
 *   comma1 — ô dấu "," sau chữ số 1 (cùng x cột số 2)
 *   comma2 — ô dấu "," sau chữ số 2 (cùng x cột số 3)
 * VD: "-1.1" = tô − + dấu phẩy sau số 1 + số 1·1; "-2" = tô − + số 2.
 */
export interface Part3Signs {
  neg: Bubble;
  comma1: Bubble;
  comma2: Bubble;
}

/** One PHẦN III câu: 4 digit columns (a 4-digit numeric answer). */
export interface Part3Question {
  /** Numeric label printed on the sheet (1-based). */
  label: number;
  columns: DigitColumnLayout[];
  /** Có trên các mẫu in thật dấu "−"/"," — mẫu không có (vd MOI) bỏ qua. */
  signs?: Part3Signs;
}

export interface CodeBlock {
  columns: DigitColumnLayout[];
  label: RectI;
}

export interface SheetLayout {
  /** Canonical sheet size used by warpPerspective (width = 1). */
  width: number;
  height: number;
  kind: FormKind;
  markers: { tl: Bubble; tr: Bubble; br: Bubble; bl: Bubble };
  /** Choice questions: PHẦN I (4 options) then PHẦN II (2 options). */
  questions: QuestionLayout[];
  /** PHẦN I question count (4-option, first in `questions`). */
  part1Count: number;
  /** PHẦN II question count (Đúng/Sai, after PHẦN I). */
  part2Count: number;
  /** PHẦN III numeric questions (4 digit columns each). */
  part3: Part3Question[];
  examCode: CodeBlock | null;
  studentCode: CodeBlock | null;
  /** Region used to render the score text on the annotated image. */
  scoreAnchor: Pt;
  /**
   * Khung "Điểm bài kiểm tra" in sẵn trên phiếu. Khi có, khối chữ đỏ được xếp
   * vào các ô trống của khung (P1 → P2 → P3 → Tong → MĐ → SBD), mỗi mục một ô,
   * thay vì đặt cạnh tiêu đề PHẦN.
   */
  scoreBox?: {
    /**
     * Các ô chữ theo ĐÚNG thứ tự cần điền: ô thứ i nhận mục thứ i của danh sách
     * [P1, P2, P3, Tong, SBD]. Toạ độ tỉ lệ trang (x theo bề rộng, y theo
     * chiều cao); `maxX` là mép phải để tự co chữ.
     */
    slots: { x: number; y: number; maxX: number }[];
    /**
     * Ô riêng cho MÃ ĐỀ ĐANG CHẤM (nếu khai báo): chữ mã đề vẽ vào ô này —
     * thường là ô "Phách" trống bên cạnh khung điểm. `prefix` mặc định "MD: ".
     */
    mdSlot?: { x: number; y: number; maxX: number };
    mdPrefix?: string;
    /** Cỡ chữ theo chiều cao ảnh (mặc định 0.016 = nửa khối cũ). */
    fs?: number;
    /** Bước nhảy ký tự (mặc định 0.42 = glyph nén như khối chữ cũ). */
    advance?: number;
  };
  columns: number;
  rows: number;
  /**
   * KHUNG CẮT ẢNH — vùng giấy thật sự chứa phiếu (khung đỏ trên ảnh tiêu chí
   * của mẫu). Toạ độ TỈ LỆ trang [0,1]. Ảnh upload được xoay thẳng rồi cắt
   * đúng vùng này trước khi chấm, nhờ vậy mọi ảnh cùng mẫu dùng chung một
   * khung tham chiếu (bỏ nền/bàn thừa, ổn định lưới).
   *
   * Đo từ `tc_qm10_11.png` (1653×2339 px = A4 595×842pt):
   *   khung đỏ  x 58..1596 px → 20.9..574.5pt → 0.0351..0.9656
   *             y  77..2261 px →  27.7..813.9pt → 0.0329..0.9666
   * 4 mốc vuông đen 33×33 tại (72.3,160.9)/(522.6,160.9)/(72.3,795.9)/
   * (522.6,795.9) pt — khớp `markers` của mẫu nên có thể tinh chỉnh khung
   * theo mốc khi ảnh bị lệch.
   */
  cropBox?: { x0: number; y0: number; x1: number; y1: number };
  /** Bubble-snap search window multiplier (default 1.0 — see reader.snap). */
  snapFactor?: number;
}

export interface ReadQuestion {
  index: number;
  /** Chosen option index, or -1 when blank / ambiguous. */
  answer: number;
  /** Per-option raw fill scores for diagnostics. */
  scores: number[];
  /** True when the question could not be read reliably. */
  unsure: boolean;
  /**
   * Tâm ô đã dùng khi đọc (canonical px), nếu lưới in lệch khỏi lưới chuẩn —
   * dùng để vẽ chú thích đúng chỗ ô in thay vì toạ độ chuẩn.
   */
  center?: { x: number; y: number };
}

export interface SheetReadResult {
  questions: ReadQuestion[];
  examCode: string | null;
  studentCode: string | null;
  /** Overall read error, mirroring the original app's -4 status. */
  readError: boolean;
  /** Warped canonical image, when the sheet was aligned. */
  warped?: { width: number; height: number; rgba: Uint8ClampedArray };
  /** Annotated preview for the results screen. */
  annotated?: { width: number; height: number; rgba: Uint8ClampedArray };
}

export type DetectStage =
  | "searching"
  | "aligned"
  | "low-sharpness"
  | "no-markers"
  | "read-error"
  | "done";

export interface DetectOutcome {
  ok: boolean;
  stage: DetectStage;
  message?: string;
  markers?: Pt[];
  warp?: { width: number; height: number; rgba: Uint8ClampedArray };
  sharpness?: number;
}
