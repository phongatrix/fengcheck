import { readFileSync, existsSync } from "node:fs";
import { it, expect } from "vitest";
import { processGray } from "@/lib/omr/pipeline";
import { gradeGiay, parsePartMaxes } from "@/lib/scoring";
import { canonicalSheet } from "@/lib/omr/sheet";
import { sectionsFromAnswers } from "@/lib/omr/key-sections";
import type { FormConfig, FormKind, GrayMat } from "@/lib/omr/types";

/**
 * Đọc lại phiếu QM_A4 / Giấy 10-11 đã tô đáp án mã đề 745 — sinh bằng
 * scripts/make-shared-scans.py từ chính 2 file PDF nhà trường in.
 */
function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/scan-${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/scan-${name}.gray`);
  return { width: meta.w, height: meta.h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) };
}

/** Đáp án 745 tách theo phần — đọc từ file Excel của app QM 2025. */
function key745() {
  const sections = JSON.parse(readFileSync("tests/fixtures/key-sections-745.json", "utf8"))["745"];
  return sections as ReturnType<typeof sectionsFromAnswers>;
}

for (const [kind, name] of [
  ["QM_A4", "qma4"],
  ["GIAY10_11", "hsg"],
] as [FormKind, string][]) {
  it(`đọc lại phiếu ${kind} đã tô mã đề 745`, { skip: !existsSync(`tests/fixtures/scan-${name}.gray`) }, () => {
    const form: FormConfig = {
      ansNumber: 0,
      optionsPerQuestion: 4,
      form: kind,
      useExamCode: true,
      useStudentCode: true,
    };
    const layout = canonicalSheet(form);
    const res = processGray(loadGray(name), { form, checkSharpness: false });
    expect(res.ok).toBe(true);

    const s = key745();
    let ok = 0;
    let total = 0;
    for (const [n, opt] of Object.entries(s.p1)) {
      const i = Number(n) - 1;
      if (i >= layout.part1Count) continue;
      total++;
      if (res.answers?.[i] === opt) ok++;
    }
    for (const [key, val] of Object.entries(s.p2)) {
      const [n, y] = key.split(",").map(Number);
      if (n > layout.part2Count / 4) continue;
      total++;
      if (res.answers?.[layout.part1Count + (n - 1) * 4 + y] === val) ok++;
    }
    for (const [n, digits] of Object.entries(s.p3)) {
      const q = Number(n) - 1;
      if (q >= layout.part3.length) continue;
      digits.forEach((d, col) => {
        if (d < 0) return;
        total++;
        if (res.answers?.[layout.part1Count + layout.part2Count + q * 4 + col] === d) ok++;
      });
    }
    console.log(`${kind}: ${ok}/${total} ô đọc đúng; mã đề ${res.examCode}, SBD ${res.studentCode}`);
    expect(ok).toBeGreaterThanOrEqual(total - 2); // cho phép 2 ô nhiễu JPEG
    expect(res.examCode?.slice(-3)).toBe("745");
  });
}
