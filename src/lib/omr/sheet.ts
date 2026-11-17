/**
 * Canonical sheet layout — the single source of truth shared by the printable
 * template generator and the OMR detector, so a printed sheet always matches.
 *
 * Geometry contract (v2, collision-free):
 *  - landscape sheet, aspect 1.75 (inside the 1.5–2.2 band the detector
 *    validates, same as the original app),
 *  - 4 solid corner markers for the perspective warp + edge registration
 *    ticks (40 right + 16 bottom, the app's 56 markers, cosmetic),
 *  - left sidebar (x 0.05–0.40): exam code (3 digit columns) + student code
 *    (6 digit columns), each column a vertical stack of 10 bubbles (0..9),
 *  - question grid (x 0.44–0.93): options A–D in a horizontal row per
 *    question, wrapped into as many super-columns as the row pitch needs.
 *
 * Coordinates are normalized: x by width, y by height, radii by min(w,h).
 */

import type { Bubble, DigitColumnLayout, QuestionLayout, SheetLayout, FormConfig } from "./types";
import { giay12Layout, giay10_11Layout, moiLayout, qmA4Layout } from "./giay-layouts";

const OPTIONS = ["A", "B", "C", "D"];

export const DEFAULT_FORM: FormConfig = {
  ansNumber: 40,
  optionsPerQuestion: 4,
  form: "A4",
  useExamCode: true,
  useStudentCode: true,
};

/** Digit-stack geometry, shared by the exam + student code blocks. */
const SIDEBAR_X0 = 0.05;
const SIDEBAR_X1 = 0.4;
const DIGIT_SLOTS = 9; // 3 exam + 6 student
const DIGIT_TOP = 0.16; // fraction of height
const DIGIT_BOTTOM = 0.92;

const Q_X0 = 0.44;
const Q_X1 = 0.93;
const Q_ROW_TOP = 0.14;
const Q_ROW_BOTTOM = 0.9;

function bubble(x: number, y: number, r: number): Bubble {
  return { x, y, r };
}

export function canonicalSheet(cfg: FormConfig): SheetLayout {
  if (cfg.form === "QM_A4") return qmA4Layout();
  if (cfg.form === "GIAY12") return giay12Layout();
  if (cfg.form === "GIAY10_11") return giay10_11Layout();
  if (cfg.form === "MOI") return moiLayout();
  return customSheet(cfg);
}

/**
 * Custom (self-designed) sheet, aspect inside the app's 1.5–2.2 band.
 * Layout v2, collision-free: left sidebar for digit codes, question grid with
 * horizontal option rows on the right.
 */
function customSheet(cfg: FormConfig): SheetLayout {
  const n = Math.max(1, cfg.ansNumber);
  const opt = Math.max(2, Math.min(8, cfg.optionsPerQuestion));

  // Canonical sheet: landscape content, aspect inside the app's 1.5–2.2 band.
  const width = 1.0;
  const height = width / 1.75;

  /* ---- digit-code sidebar ---- */
  // Radii are stored in min-side units (readers multiply by min(w,h)).
  // Compute them via canonical pixels: width = 1000 px, height = 571.43 px,
  // so min side = height * 1000 px.
  const colPitch = (SIDEBAR_X1 - SIDEBAR_X0) / DIGIT_SLOTS; // fraction of width
  const minSidePx = height * 1000;
  const colPitchPx = colPitch * 1000;
  const digitRowPitchPx = ((DIGIT_BOTTOM - DIGIT_TOP) / 9) * minSidePx;
  const digitR = (Math.min(colPitchPx, digitRowPitchPx) * 0.34) / minSidePx;

  const buildColumns = (slot0: number, count: number): DigitColumnLayout[] => {
    const out: DigitColumnLayout[] = [];
    for (let c = 0; c < count; c++) {
      const cx = SIDEBAR_X0 + (slot0 + c + 0.5) * colPitch;
      const bubbles: Bubble[] = [];
      for (let d = 0; d < 10; d++) {
        // y is a fraction of height — DIGIT_TOP/BOTTOM already are, no re-scale.
        bubbles.push(bubble(cx, DIGIT_TOP + d * ((DIGIT_BOTTOM - DIGIT_TOP) / 9), digitR));
      }
      out.push({ bubbles });
    }
    return out;
  };

  const studentSlot0 = cfg.useExamCode ? 3 : 0;
  const examColumns = cfg.useExamCode ? buildColumns(0, 3) : [];
  const studentColumns = cfg.useStudentCode ? buildColumns(studentSlot0, 6) : [];

  const examLabel = { x: SIDEBAR_X0, y: 0.105, w: 3 * colPitch, h: 0.05 };
  const studentLabel = { x: SIDEBAR_X0 + studentSlot0 * colPitch, y: 0.105, w: 6 * colPitch, h: 0.05 };

  /* ---- question grid ---- */
  const qCols = n <= 25 ? 1 : n <= 50 ? 2 : n <= 75 ? 3 : 4;
  const qRows = Math.ceil(n / qCols);
  const colW = (Q_X1 - Q_X0) / qCols; // fraction of width
  const optPitchPx = (colW / opt) * 1000;
  const rowPitchPx = ((Q_ROW_BOTTOM - Q_ROW_TOP) / Math.max(1, qRows)) * minSidePx;

  // Ring radius in min-side units: never wider than ~36% of the tighter pitch.
  const qR = Math.min(20, rowPitchPx * 0.36, optPitchPx * 0.36) / minSidePx;

  const questions: QuestionLayout[] = [];
  let qIdx = 0;
  for (let col = 0; col < qCols && qIdx < n; col++) {
    for (let row = 0; row < qRows && qIdx < n; row++) {
      // y is a fraction of height — Q_ROW_TOP/BOTTOM already are, no re-scale.
      const qy = Q_ROW_TOP + (row + 0.5) * ((Q_ROW_BOTTOM - Q_ROW_TOP) / qRows);
      const bubbles: Bubble[] = [];
      for (let o = 0; o < opt; o++) {
        bubbles.push(bubble(Q_X0 + (col + (o + 0.5) / opt) * colW, qy, qR));
      }
      questions.push({ index: qIdx, bubbles });
      qIdx++;
    }
  }

  /* ---- corner markers (warp anchors) ---- */
  // NOTE: x is a fraction of width, y a fraction of height — do not
  // pre-multiply by `height`, that double-scales the inset and skews the
  // marker quad's aspect ratio.
  const markers = {
    tl: bubble(0.045, 0.045, 0.018),
    tr: bubble(1 - 0.045, 0.045, 0.018),
    br: bubble(1 - 0.045, 1 - 0.045, 0.018),
    bl: bubble(0.045, 1 - 0.045, 0.018),
  };

  const scoreAnchor = { x: width * 0.66, y: 0.07 };

  return {
    width,
    height,
    kind: cfg.form,
    markers,
    questions,
    part1Count: questions.length,
    part2Count: 0,
    part3: [],
    examCode: cfg.useExamCode ? { columns: examColumns, label: examLabel } : null,
    studentCode: cfg.useStudentCode ? { columns: studentColumns, label: studentLabel } : null,
    scoreAnchor,
    columns: qCols,
    rows: qRows,
  };
}

/** Question bubble centers as rects for the detector's per-option rects. */
export function questionRects(layout: SheetLayout): { index: number; rects: { x: number; y: number; w: number; h: number }[] }[] {
  return layout.questions.map((q) => ({
    index: q.index,
    rects: q.bubbles.map((b) => ({ x: b.x - b.r, y: b.y - b.r, w: 2 * b.r, h: 2 * b.r })),
  }));
}

export const OPTION_LABELS = OPTIONS;
