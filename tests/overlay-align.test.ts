/**
 * Ráp đáp án phải nằm ĐÚNG tâm ô tròn in sẵn trên mẫu giấy thật.
 *
 * Fixture pdf-bubbles.json = tâm mọi ô tròn lấy trực tiếp từ vector của
 * QM_2025_A4_Ky-kiem-tra.pdf / Giay10_11.pdf (đơn vị pt, trang 595 × 842).
 * Mỗi dấu overlay phải trùng một tâm trong danh sách đó.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { marksForLayout, type KeySections } from "@/lib/omr/key-sections";
import type { FormKind } from "@/lib/omr/types";

const PAGE = { w: 595, h: 842 };
const bubbles = JSON.parse(readFileSync("tests/fixtures/pdf-bubbles.json", "utf8")) as Record<
  string,
  [number, number][]
>;

/** Đáp án phủ kín mọi ô: P1 A–D xoay vòng, P2 Đ/S xoay vòng, P3 đủ 4 chữ số. */
function fullSections(): KeySections {
  const s: KeySections = { p1: {}, p2: {}, p3: {}, p3Signs: {} };
  for (let n = 1; n <= 40; n++) s.p1[n] = (n - 1) % 4;
  for (let n = 1; n <= 10; n++) for (let y = 0; y < 4; y++) s.p2[`${n},${y}`] = (n + y) % 2;
  for (let n = 1; n <= 10; n++) s.p3[n] = [n % 10, (n + 3) % 10, (n + 6) % 10, (n + 9) % 10];
  return s;
}

function nearest(pt: [number, number], list: [number, number][]) {
  let best = Infinity;
  for (const [x, y] of list) {
    const d = Math.hypot(x - pt[0], y - pt[1]);
    if (d < best) best = d;
  }
  return best;
}

describe("overlay đáp án trên mẫu giấy thật", () => {
  for (const [form, fixture] of [
    ["QM_A4", "qm-a4"],
    ["GIAY10_11", "qm-hsg"],
  ] as [FormKind, string][]) {
    it(`${form}: mọi dấu trùng tâm ô in sẵn (±0.6pt)`, () => {
      const layout = canonicalSheet({
        ansNumber: 0,
        optionsPerQuestion: 4,
        form,
        useExamCode: true,
        useStudentCode: true,
      });
      const marks = marksForLayout(layout, fullSections(), { examCode: "745", studentCode: "006400" });
      expect(marks.length).toBeGreaterThan(50);
      const list = bubbles[fixture];
      const worst = marks
        .map((m) => nearest([m.bubble.x * PAGE.w, m.bubble.y * PAGE.h], list))
        .reduce((a, b) => Math.max(a, b), 0);
      expect(worst).toBeLessThan(0.6);
    });

    it(`${form}: số dấu = số ô mẫu có (không vẽ thừa/thiếu)`, () => {
      const layout = canonicalSheet({
        ansNumber: 0,
        optionsPerQuestion: 4,
        form,
        useExamCode: true,
        useStudentCode: true,
      });
      const s = fullSections();
      const marks = marksForLayout(layout, s, { examCode: "745", studentCode: "006400" });
      const p1 = Object.keys(s.p1).filter((n) => Number(n) <= layout.part1Count).length;
      const p2 = Object.keys(s.p2).filter((k) => Number(k.split(",")[0]) <= layout.part2Count / 4).length;
      const p3 = Object.keys(s.p3).filter((n) => Number(n) <= layout.part3.length).length * 4;
      const codes = 3 + (layout.studentCode ? 6 : 0);
      expect(marks.length).toBe(p1 + p2 + p3 + codes);
    });
  }
});
