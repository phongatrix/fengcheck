/**
 * Dump layout của 2 mẫu dùng chung ra /tmp/shared-layouts.json — cho script
 * scripts/make-shared-scans.py tô đúng ô tròn.
 * Chạy: npx vitest run tests/dump-shared-layouts.test.ts
 */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";
import type { FormKind } from "@/lib/omr/types";

it("dump shared layouts", () => {
  const out: Record<string, unknown> = {};
  for (const kind of ["QM_A4", "GIAY10_11"] as FormKind[]) {
    const l = canonicalSheet({
      ansNumber: 0,
      optionsPerQuestion: 4,
      form: kind,
      useExamCode: true,
      useStudentCode: true,
    });
    out[kind] = {
      width: l.width,
      height: l.height,
      part1Count: l.part1Count,
      part2Count: l.part2Count,
      totalQuestions: layoutQuestionCount(l),
      questions: l.questions,
      part3: l.part3,
      examCode: l.examCode,
      studentCode: l.studentCode,
      markers: l.markers,
    };
  }
  writeFileSync("/tmp/shared-layouts.json", JSON.stringify(out));
  console.log("dumped shared layouts");
});
