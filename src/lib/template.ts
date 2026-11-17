/**
 * Printable answer-sheet template generator.
 *
 * Draws the exact same canonical layout the detector reads, so a printed sheet
 * always aligns with the OMR pipeline. Output is SVG (vector, print-perfect)
 * and can be downloaded or opened in a new tab for printing.
 */

import { canonicalSheet, OPTION_LABELS } from "./omr/sheet";
import type { FormConfig, SheetLayout } from "./omr/types";

export interface TemplateOptions {
  form: FormConfig;
  quizName?: string;
  /** Sheet width in millimetres (A4 = 210). */
  pageWidthMm?: number;
  /** Đáp án key để ráp lên mẫu giấy (tô đậm ô đúng). */
  answers?: number[];
}

const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A6: { w: 105, h: 148 },
  A8: { w: 74, h: 105 },
};

/** Build an SVG string for printing. Uses mm units so printing is 1:1. */
export function buildSheetSvg(opts: TemplateOptions): string {
  const { form, quizName } = opts;
  const page = PAGE_SIZES[form.form] ?? PAGE_SIZES.A4;
  const layout = canonicalSheet(form);

  // The sheet uses landscape content on a portrait page, with the canonical
  // width mapped to the printable width and height to its aspect.
  const margin = 8;
  const printW = page.w - margin * 2;
  const printH = printW / (layout.width / layout.height);

  const px = (u: number) => (u * printW).toFixed(3);
  const py = (u: number) => (u * printH).toFixed(3);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}mm" height="${page.h}mm" viewBox="0 0 ${page.w} ${page.h}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<g transform="translate(${margin}, ${margin})">`,
  );

  // Sheet border.
  parts.push(
    `<rect x="0" y="0" width="${printW}" height="${printH}" fill="none" stroke="#111" stroke-width="0.5"/>`,
  );

  // Title.
  if (quizName) {
    parts.push(
      `<text x="${printW / 2}" y="${(printH * 0.025).toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="${(printH * 0.018).toFixed(2)}" text-anchor="middle" fill="#111">${escapeXml(quizName)}</text>`,
    );
  }

  // Four corner markers — solid black squares (the warp anchors).
  const bmin = Math.min(printW / layout.width, printH / layout.height);
  for (const key of ["tl", "tr", "br", "bl"] as const) {
    const m = layout.markers[key];
    const markerSize = m.r * 2 * bmin;
    parts.push(
      `<rect x="${(m.x * printW - markerSize / 2).toFixed(3)}" y="${(m.y * printH - markerSize / 2).toFixed(3)}" width="${markerSize.toFixed(3)}" height="${markerSize.toFixed(3)}" fill="#000"/>`,
    );
  }

  // Edge registration ticks — custom layouts only.
  if (layout.kind === "A4" || layout.kind === "A6" || layout.kind === "A8") {
    const tick = Math.min(printW, printH) * 0.008;
    for (let i = 0; i < 40; i++) {
      const y = py(0.12 + (i * 0.78) / 39);
      parts.push(
        `<rect x="${(printW - tick * 2.2).toFixed(3)}" y="${y}" width="${tick.toFixed(3)}" height="${tick.toFixed(3)}" fill="#000"/>`,
      );
    }
    for (let i = 0; i < 16; i++) {
      const x = px(0.06 + (i * 0.88) / 15);
      parts.push(
        `<rect x="${x}" y="${(printH - tick * 2.2).toFixed(3)}" width="${tick.toFixed(3)}" height="${tick.toFixed(3)}" fill="#000"/>`,
      );
    }
  }

  if (layout.examCode) {
    parts.push(...drawCodeBlock(layout, printW, printH, "MÃ ĐỀ", layout.examCode.label, layout.examCode.columns));
  }
  if (layout.studentCode) {
    parts.push(...drawCodeBlock(layout, printW, printH, "MÃ SV / SBD", layout.studentCode.label, layout.studentCode.columns));
  }

  // Question bubbles.
  const bw = printW / layout.width;
  const bh = printH / layout.height;
  let p3Base = layout.questions.length;
  for (const q3 of layout.part3) {
    for (const col of q3.columns) {
      const chosen = opts.answers ? opts.answers[p3Base] : -1;
      for (let d = 0; d < col.bubbles.length; d++) {
        const b = col.bubbles[d];
        const r = b.r * Math.min(bw, bh);
        const cx = b.x * printW;
        const cy = b.y * printH;
        const isKey = chosen === d;
        parts.push(
          `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" fill="${isKey ? "#1d44ad" : "#fff"}" stroke="#333" stroke-width="0.25"/>`,
        );
        parts.push(
          `<text x="${(cx - r * 2.2).toFixed(3)}" y="${(cy + r * 0.5).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(r * 1.1).toFixed(3)}" fill="#666" text-anchor="end">${d}</text>`,
        );
      }
      p3Base += 1;
    }
    const first = q3.columns[0]?.bubbles[0];
    if (first) {
      parts.push(
        `<text x="${(first.x * printW - printW * 0.02).toFixed(3)}" y="${(first.y * printH - printH * 0.008).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(bh * 0.014).toFixed(3)}" fill="#111">Câu ${q3.label}</text>`,
      );
    }
    // Ô dấu − và dấu thập phân, in cùng lưới với cột chữ số tương ứng.
    if (q3.signs) {
      const drawSign = (b: typeof first, glyph: string) => {
        const r = b.r * Math.min(bw, bh);
        const cx = b.x * printW;
        const cy = b.y * printH;
        parts.push(
          `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" fill="#fff" stroke="#333" stroke-width="0.25"/>`,
        );
        parts.push(
          `<text x="${(cx - r * 2.2).toFixed(3)}" y="${(cy + r * 0.5).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(r * 1.3).toFixed(3)}" fill="#666" text-anchor="end">${glyph}</text>`,
        );
      };
      drawSign(q3.signs.neg, "−");
      drawSign(q3.signs.comma1, ",");
      drawSign(q3.signs.comma2, ",");
    }
  }
  for (const q of layout.questions) {
    const chosen = opts.answers ? opts.answers[q.index] : -1;
    q.bubbles.forEach((b, oi) => {
      const r = b.r * Math.min(bw, bh);
      const cx = b.x * printW;
      const cy = b.y * printH;
      const isKey = chosen === oi;
      parts.push(
        `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" fill="${isKey ? "#1d44ad" : "#fff"}" stroke="#333" stroke-width="0.25"/>`,
      );
      parts.push(
        `<text x="${(cx + r * 1.5).toFixed(3)}" y="${(cy + r * 0.55).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(r * 1.15).toFixed(3)}" fill="#333">${OPTION_LABELS[oi]}</text>`,
      );
    });
    const qr = q.bubbles[0].r * Math.min(bw, bh);
    parts.push(
      `<text x="${(q.bubbles[0].x * printW - qr * 3).toFixed(3)}" y="${(q.bubbles[0].y * printH + bh * 0.004).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(bh * 0.011).toFixed(3)}" fill="#555" text-anchor="end">${q.index + 1}</text>`,
    );
  }

  parts.push("</g></svg>");
  return parts.join("\n");
}

function drawCodeBlock(
  layout: SheetLayout,
  printW: number,
  printH: number,
  label: string,
  labelRect: { x: number; y: number; w: number; h: number },
  columns: { bubbles: { x: number; y: number; r: number }[] }[],
): string[] {
  const out: string[] = [];
  const bw = printW / layout.width;
  const bh = printH / layout.height;
  out.push(
    `<text x="${(labelRect.x * printW).toFixed(3)}" y="${(labelRect.y * printH).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(bh * 0.02).toFixed(3)}" fill="#111">${escapeXml(label)}</text>`,
  );
  for (const col of columns) {
    for (let d = 0; d < col.bubbles.length; d++) {
      const b = col.bubbles[d];
      const r = b.r * Math.min(bw, bh);
      const cx = b.x * printW;
      const cy = b.y * printH;
      out.push(
        `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" fill="#fff" stroke="#333" stroke-width="0.25"/>`,
      );
      out.push(
        `<text x="${(cx - r * 2.2).toFixed(3)}" y="${(cy + r * 0.5).toFixed(3)}" font-family="Helvetica, Arial, sans-serif" font-size="${(r * 1.1).toFixed(3)}" fill="#666" text-anchor="end">${d}</text>`,
      );
    }
  }
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Trigger a browser download for the SVG template. */
export function downloadTemplate(opts: TemplateOptions): void {
  const svg = buildSheetSvg(opts);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phieu-cham-${opts.form.form}-${opts.form.ansNumber}cau.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Render the template onto a canvas (used for previews and PNG export). */
export async function renderTemplateToCanvas(
  opts: TemplateOptions,
  width = 1600,
): Promise<HTMLCanvasElement> {
  const svg = buildSheetSvg(opts);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Không dựng được mẫu phiếu"));
      img.src = url;
    });
    const page = PAGE_SIZES[opts.form.form] ?? PAGE_SIZES.A4;
    const ratio = page.h / page.w;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
