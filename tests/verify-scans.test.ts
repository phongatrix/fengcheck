import { readFileSync, existsSync } from "node:fs";

const hasFixture = (n: string) => existsSync(`tests/fixtures/scan-${n}.meta.json`);
import { it, expect } from "vitest";
import { processGray } from "@/lib/omr/pipeline";
import { gradeGiay, parsePartMaxes } from "@/lib/scoring";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/scan-${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/scan-${name}.gray`);
  return { width: meta.w, height: meta.h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) };
}

it("reads the realistic Giay12 scan", { skip: !hasFixture("giay12") }, () => {
  const form: FormConfig = { ansNumber: 96, optionsPerQuestion: 4, form: "GIAY12", useExamCode: true, useStudentCode: true };
  const layout = canonicalSheet(form);
  const res = processGray(loadGray("giay12"), { form, checkSharpness: false });
  expect(res.ok).toBe(true);
  console.log("giay12 exam:", res.examCode, "student:", res.studentCode);
  const answers = res.answers ?? [];
  const expected = Array.from({ length: 96 }, (_, i) =>
    i < 40 ? i % 4 : i < 72 ? i % 2 : (i * 3) % 10);
  let ok = 0;
  for (let i = 0; i < 96; i++) if (answers[i] === expected[i]) ok++;
  console.log("giay12 correct:", ok, "/96; P1 first10:", answers.slice(0, 10).map((a) => (a >= 0 ? "ABCD"[a] : "-")).join(""));
  expect(res.examCode).toBe("314");
  expect(ok).toBeGreaterThan(86);
  // điểm đầy đủ
  const key = expected;
  const grade = gradeGiay({ p1: 40, p2: 8, p3: 6 }, key, answers, parsePartMaxes("6,4,0"));
  console.log("grade:", grade.lines.join(" | "));
  expect(grade.totalScore).toBeGreaterThan(9);
});

it("reads the realistic Giay10_11 scan", { skip: !hasFixture("giay1011") }, () => {
  const form: FormConfig = { ansNumber: 110, optionsPerQuestion: 4, form: "GIAY10_11", useExamCode: true, useStudentCode: false };
  const res = processGray(loadGray("giay1011"), { form, checkSharpness: false });
  expect(res.ok).toBe(true);
  console.log("giay1011 exam:", res.examCode);
  const answers = res.answers ?? [];
  const expected = Array.from({ length: 110 }, (_, i) =>
    i < 30 ? (i + 1) % 4 : i < 70 ? (i + 1) % 2 : (i * 7) % 10);
  let ok = 0;
  for (let i = 0; i < 110; i++) if (answers[i] === expected[i]) ok++;
  console.log("giay1011 correct:", ok, "/110; P1 first10:", answers.slice(0, 10).map((a) => (a >= 0 ? "ABCD"[a] : "-")).join(""));
  expect(res.examCode).toBe("268");
  expect(ok).toBeGreaterThan(99);
});
