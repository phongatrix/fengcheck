/**
 * Synthetic sheet renderer used by tests and the in-app template preview.
 *
 * Draws a grayscale "photo" of a filled answer sheet that exactly matches the
 * canonical layout consumed by the detector — the same geometry the printable
 * SVG uses. Works for every layout kind (custom A4 and the two real Giấy
 * templates) because it renders straight from the SheetLayout data.
 */

import { canonicalSheet } from "./sheet";
import type { FormConfig, GrayMat, SheetLayout } from "./types";

export interface RenderSheetOptions {
  form: FormConfig;
  /** Answer per question (choice options or digit value 0..9). -1 leaves blank. */
  answers: number[];
  /** Exam code; right-aligned into the grid ("" or fewer digits = blanks). */
  examCode?: string;
  /** Student code digits, left-aligned like the sheet. */
  studentCode?: string;
  /** Rendered sheet width in px. */
  paperWidth?: number;
  /** Additive noise amplitude (0 disables). */
  noise?: number;
  /** Rotate the output by 90° multiples to simulate a photo orientation. */
  rotate?: 0 | 90 | 180 | 270;
}

export function renderSheetToGray(opts: RenderSheetOptions): GrayMat {
  const layout: SheetLayout = canonicalSheet(opts.form);
  const width = opts.paperWidth ?? 1200;
  const height = Math.round(width / (layout.width / layout.height));
  const data = new Uint8ClampedArray(width * height).fill(250);

  const setPx = (x: number, y: number, v: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    data[yi * width + xi] = v;
  };

  const fillCircle = (cx: number, cy: number, r: number, v: number, ring = false) => {
    const r2 = r * r;
    const rIn = (r - Math.max(1.5, r * 0.22)) ** 2;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r2) continue;
        if (ring && d2 < rIn) continue;
        setPx(x, y, v);
      }
    }
  };

  const fillRect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) setPx(x, y, v);
    }
  };

  const sx = width;
  const sy = height;
  const minSide = Math.min(sx, sy);
  const px = (b: { x: number }) => b.x * sx;
  const py = (b: { y: number }) => b.y * sy;
  const pr = (b: { r: number }) => Math.max(3, b.r * minSide);

  // Four solid corner markers (what the detector locks onto) — sized from
  // the layout so the Giấy templates keep their true marker proportions.
  for (const key of ["tl", "tr", "br", "bl"] as const) {
    const m = layout.markers[key];
    const marker = m.r * 2 * minSide;
    fillRect(px(m) - marker / 2, py(m) - marker / 2, marker, marker, 20);
  }

  // Edge registration ticks — custom layouts only (the Giấy templates have
  // their own printed edge markers instead).
  if (layout.kind === "A4" || layout.kind === "A6" || layout.kind === "A8") {
    for (let i = 0; i < 40; i++) {
      const y = (0.12 + (i * 0.78) / 39) * sy;
      fillRect(sx * 0.955, y, minSide * 0.008, minSide * 0.008, 30);
    }
    for (let i = 0; i < 16; i++) {
      const x = (0.06 + (i * 0.88) / 15) * sx;
      fillRect(x, sy * 0.955, minSide * 0.008, minSide * 0.008, 30);
    }
  }

  // Digit grids: draw unselected rings, fill the chosen digit.
  const drawCode = (
    columns: { bubbles: { x: number; y: number; r: number }[] }[],
    code: string | undefined,
    rightAlign = false,
  ) => {
    if (!code) return;
    const digits = code.split("");
    const pad = rightAlign ? Math.max(0, columns.length - digits.length) : 0;
    columns.forEach((col, ci) => {
      const digitChar = rightAlign ? (ci >= pad ? digits[ci - pad] : undefined) : digits[ci];
      const digit = digitChar ? Number.parseInt(digitChar, 10) : Number.NaN;
      col.bubbles.forEach((b, di) => {
        fillCircle(px(b), py(b), pr(b), 210, true);
        if (di === digit) fillCircle(px(b), py(b), pr(b) * 0.78, 35);
      });
    });
  };

  if (layout.examCode) drawCode(layout.examCode.columns, opts.examCode, layout.examCode.columns.length > 3);
  if (layout.studentCode) drawCode(layout.studentCode.columns, opts.studentCode);

  // Choice questions (PHẦN I + PHẦN II).
  layout.questions.forEach((q, qi) => {
    const chosen = opts.answers[qi] ?? -1;
    q.bubbles.forEach((b, oi) => {
      fillCircle(px(b), py(b), pr(b), 205, true);
      if (oi === chosen) {
        // Fill most of the bubble but leave a thin light rim, like real pencil.
        fillCircle(px(b), py(b), pr(b) * 0.82, 30);
      }
    });
  });

  // PHẦN III digit columns — answers continue after the choice questions.
  let p3Base = layout.questions.length;
  // Ô dấu nằm sau các ô chữ số của vector: mỗi câu có dấu 2 ô [−, dấu thập phân].
  const signBase = layout.questions.length + layout.part3.reduce((s, q) => s + q.columns.length, 0);
  let signIdx = 0;
  layout.part3.forEach((q) => {
    if (q.signs) {
      const negOn = opts.answers[signBase + signIdx * 2] === 0;
      const comma = opts.answers[signBase + signIdx * 2 + 1] ?? -1;
      const signs = [
        [q.signs.neg, negOn ? 0 : -1],
        [q.signs.comma1, comma === 0 ? 0 : -1],
        [q.signs.comma2, comma === 1 ? 0 : -1],
      ] as const;
      signs.forEach(([b, v]) => {
        fillCircle(px(b), py(b), pr(b), 205, true);
        if (v === 0) fillCircle(px(b), py(b), pr(b) * 0.72, 30);
      });
      signIdx += 1;
    }
    q.columns.forEach((col) => {
      const chosen = opts.answers[p3Base] ?? -1;
      col.bubbles.forEach((b, di) => {
        fillCircle(px(b), py(b), pr(b), 205, true);
        if (di === chosen) fillCircle(px(b), py(b), pr(b) * 0.82, 30);
      });
      p3Base += 1;
    });
  });

  if (opts.noise) {
    for (let i = 0; i < data.length; i++) {
      const n = (Math.random() - 0.5) * opts.noise;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
    }
  }

  const rotated = opts.rotate ? rotateGray({ width, height, data }, opts.rotate) : { width, height, data };
  return rotated;
}

function rotateGray(mat: GrayMat, deg: 90 | 180 | 270): GrayMat {
  const { width, height, data } = mat;
  if (deg === 180) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = data[(height - 1 - y) * width + (width - 1 - x)];
      }
    }
    return { width, height, data: out };
  }
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x];
      if (deg === 90) {
        const nx = height - 1 - y;
        const ny = x;
        out[ny * height + nx] = v;
      } else {
        const nx = y;
        const ny = width - 1 - x;
        out[ny * height + nx] = v;
      }
    }
  }
  return { width: height, height: width, data: out };
}
