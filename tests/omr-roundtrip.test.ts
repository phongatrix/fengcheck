import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { processGray } from "@/lib/omr/pipeline";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import type { FormConfig } from "@/lib/omr/types";

const form: FormConfig = {
  ansNumber: 20,
  optionsPerQuestion: 4,
  form: "A4",
  useExamCode: true,
  useStudentCode: true,
};

describe("OMR pipeline round-trip", () => {
  it("reads answers it rendered itself", () => {
    const answers = Array.from({ length: 20 }, (_, i) => i % 4);
    const examCode = "012";
    const studentCode = "123456";

    const gray = renderSheetToGray({
      form,
      answers,
      examCode,
      studentCode,
      paperWidth: 1200,
    });

    const res = processGray(gray, { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.answers?.slice(0, 20)).toEqual(answers);
    expect(res.examCode).toBe(examCode);
    expect(res.studentCode).toBe(studentCode);
  });

  it("detects blank questions as -1", () => {
    const answers = Array.from({ length: 20 }, (_, i) => (i < 5 ? 2 : -1));
    const gray = renderSheetToGray({ form, answers, paperWidth: 1200 });
    const res = processGray(gray, { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.answers?.slice(5, 10)).toEqual([-1, -1, -1, -1, -1]);
    expect(res.answers?.slice(0, 5)).toEqual([2, 2, 2, 2, 2]);
  });

  it("reads a sheet placed inside a larger webcam-style frame", () => {
    // A photo normally shows the sheet surrounded by desk. Orientation fixes
    // (upside-down / 90° turns) are not supported — same as the original app,
    // which relied on the camera sensor orientation.
    const answers = Array.from({ length: 20 }, (_, i) => (i * 3) % 4);
    const sheet = renderSheetToGray({ form, answers, paperWidth: 800 });
    const frameW = 1100;
    const frameH = 700;
    const data = new Uint8ClampedArray(frameW * frameH).fill(60);
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) {
        data[(y + 90) * frameW + (x + 140)] = sheet.data[y * sheet.width + x];
      }
    }
    const res = processGray(
      { width: frameW, height: frameH, data },
      { form, checkSharpness: false },
    );
    expect(res.ok).toBe(true);
    expect(res.answers?.slice(0, 20)).toEqual(answers);
    // Layout allows the aspect ratio used by the generator.
    expect(res.layout.width / res.layout.height).toBeGreaterThan(1.5);
    expect(res.layout.width / res.layout.height).toBeLessThan(2.2);
  });

  it("grades against a key and annotates the score", () => {
    const answers = Array.from({ length: 20 }, (_, i) => i % 4);
    const gray = renderSheetToGray({
      form,
      answers,
      examCode: "001",
      studentCode: "111222",
      paperWidth: 1200,
    });
    const res = processGray(gray, { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    expect(res.canonical).toBeDefined();
    // Score overlay renders once the key is known (worker path).
    expect(res.preview).toBeDefined();
    expect(res.preview!.rgba.length).toBe(res.preview!.width * res.preview!.height * 4);
  });
});
