/**
 * Sinh fixture lưới đáp án (JSON) cho scripts/make-realistic-scans.py.
 * Chạy: npx vitest run tests/dump-layout.test.ts
 */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";
import type { FormKind } from "@/lib/omr/types";

it("dump layouts", () => {
  for (const kind of ["GIAY12", "GIAY10_11", "MOI"] as FormKind[]) {
    const form = {
      ansNumber: 0,
      optionsPerQuestion: 4,
      form: kind,
      useExamCode: true,
      useStudentCode: kind !== "GIAY10_11" && kind !== "MOI",
    };
    const l = canonicalSheet(form);
    writeFileSync(
      `tests/fixtures/layout-${kind}.json`,
      JSON.stringify({
        aspect: l.width / l.height,
        totalQuestions: layoutQuestionCount(l),
        markers: l.markers,
        questions: l.questions,
        part3: l.part3,
        examCode: l.examCode,
        studentCode: l.studentCode,
      }),
    );
  }
  console.log("dumped");
});
