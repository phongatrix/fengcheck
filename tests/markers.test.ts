import { describe, expect, it } from "vitest";
import { detectCornerMarkers, connectedComponents } from "@/lib/omr/markers";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { resizeMat, thresholdInv } from "@/lib/omr/matrix";
import type { FormConfig, Pt } from "@/lib/omr/types";

const form: FormConfig = {
  ansNumber: 20,
  optionsPerQuestion: 4,
  form: "A4",
  useExamCode: true,
  useStudentCode: true,
};

/** Simulate a webcam view: scale the sheet and shift it inside a larger frame. */
function webcamLike(sheet: ReturnType<typeof renderSheetToGray>, frameW: number, frameH: number, dx: number, dy: number) {
  const out = new Uint8ClampedArray(frameW * frameH).fill(60); // dark desk
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= frameW || ty >= frameH) continue;
      out[ty * frameW + tx] = sheet.data[y * sheet.width + x];
    }
  }
  return { width: frameW, height: frameH, data: out };
}

describe("corner marker detection", () => {
  it("finds the quad on a clean flat sheet", () => {
    const gray = renderSheetToGray({ form, answers: Array(20).fill(0), paperWidth: 1000 });
    const res = detectCornerMarkers(gray, { checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.quad).not.toBeNull();
    const quad = res.quad!;
    // TL before TR in x, top corners above bottom corners.
    expect(quad[0].x).toBeLessThan(quad[1].x);
    expect(quad[3].x).toBeLessThan(quad[2].x);
    expect(quad[0].y).toBeLessThan(quad[3].y);
    expect(quad[1].y).toBeLessThan(quad[2].y);
  });

  it("locks onto the sheet inside a larger webcam-style frame", () => {
    const sheet = renderSheetToGray({ form, answers: Array(20).fill(1), paperWidth: 700 });
    const gray = webcamLike(sheet, 1000, 563, 120, 60);
    const res = detectCornerMarkers(gray, { checkSharpness: false });
    expect(res.ok).toBe(true);
    const quad = res.quad!;
    // The detected quad should sit roughly where the sheet was pasted.
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...xs)).toBeLessThan(840);
    expect(Math.min(...ys)).toBeGreaterThan(40);
  });

  it("rejects frames that are too blurry", () => {
    let gray = renderSheetToGray({ form, answers: Array(20).fill(0), paperWidth: 1000 });
    // Aggressive box blur → sharpness collapses.
    for (let i = 0; i < 6; i++) {
      gray = blur(gray);
    }
    const res = detectCornerMarkers(gray, { checkSharpness: true, minSharpness: 90 });
    expect(res.ok).toBe(false);
  });

  it("counts the printed solid blocks as connected blobs", () => {
    const gray = renderSheetToGray({ form, answers: Array(20).fill(-1), paperWidth: 1000 });
    // Binary map: dark ink (markers, ticks) is foreground.
    const bin = thresholdInv(gray, 128);
    const blobs = connectedComponents(bin, 8);
    // At minimum the 4 solid corner markers are blobs.
    expect(blobs.length).toBeGreaterThanOrEqual(4);
  });

  it("probeGray scales points back to the original resolution", () => {
    const gray = renderSheetToGray({ form, answers: Array(20).fill(2), paperWidth: 1600 });
    const small = resizeMat(gray, 800, Math.round((800 * gray.height) / gray.width));
    const res = detectCornerMarkers(small, { checkSharpness: false });
    expect(res.ok).toBe(true);
    const quad: Pt[] = res.quad!;
    for (const p of quad) {
      expect(p.x).toBeLessThanOrEqual(small.width);
      expect(p.y).toBeLessThanOrEqual(small.height);
    }
  });
});

/** Separable 5×5 box blur applied twice for cheap smoothing. */
function blur(mat: { width: number; height: number; data: Uint8ClampedArray }) {
  const { width, height, data } = mat;
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) s += data[y * width + Math.min(width - 1, Math.max(0, x + d))];
      tmp[y * width + x] = s / 5;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) s += tmp[Math.min(height - 1, Math.max(0, y + d)) * width + x];
      out[y * width + x] = s / 5;
    }
  }
  return { width, height, data: out };
}

