import { readFileSync, existsSync } from "node:fs";

const hasFixture = (n: string) => existsSync(`tests/fixtures/scan-${n}.meta.json`);
import { it, expect } from "vitest";
import { processGray } from "@/lib/omr/pipeline";
import { gradeGiay, parsePartMaxes } from "@/lib/scoring";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/scan-${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/scan-${name}.gray`);
  return { width: meta.w, height: meta.h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) };
}

it("reads the realistic MOI scan", { skip: !hasFixture("moi") }, () => {
  const form: FormConfig = { ansNumber: 68, optionsPerQuestion: 4, form: "MOI", useExamCode: true, useStudentCode: false };
  const layout = canonicalSheet(form);
  const total = layoutQuestionCount(layout);
  const res = processGray(loadGray("moi"), { form, checkSharpness: false });
  console.log("ok:", res.ok, "exam:", res.examCode, "quad:", res.markers?.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(" "));
  // Kỳ vọng = đáp án key 101 đã tô vào scan (dump bởi tests/dump-key101)
  const key101: { code: string; answers: number[] } = JSON.parse(
    readFileSync("tests/fixtures/key101.json", "utf8"),
  );
  const expected = key101.answers;
  const answers = res.answers ?? [];
  let ok = 0;
  for (let i = 0; i < total; i++) if (answers[i] === expected[i]) ok++;
  console.log("correct:", ok, "/", total);
  console.log("P1 read :", answers.slice(0, 20).map((a) => (a >= 0 ? "ABCD"[a] : "-")).join(""));
  console.log("P1 expect:", expected.slice(0, 20).map((a) => (a >= 0 ? "ABCD"[a] : "-")).join(""));
  console.log("P2 read :", answers.slice(20, 36).join(","));
  console.log("P2 expect:", expected.slice(20, 36).join(","));
  expect(res.ok).toBe(true);
  expect(res.examCode).toBe("101"); // key 101 đã tô vào lưới mã đề
  // moi.png là ảnh reconstruction (median ảnh chụp) — nét kém, hàng uốn nên đọc
  // best-effort ~78%; khi có file PDF/scan sạch của mẫu 2025 sẽ hiệu chỉnh được.
  // Mã đề + phần lớn P1/P2 đọc được; baseline nhiều do ảnh reconstruction.
  expect(ok).toBeGreaterThanOrEqual(28);
});
