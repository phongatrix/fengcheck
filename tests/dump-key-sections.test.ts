/**
 * Dump toạ độ dấu overlay (pt) của mã 745 trên CẢ 2 mẫu — để script Python
 * kiểm tra dấu rơi đúng vào ô tròn in sẵn trên ảnh mẫu giấy thật.
 * Chạy: npx vitest run tests/dump-key-sections.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import * as XLSX from "xlsx";
import { parseQm2025Rows } from "@/lib/qm2025-import";
import { sectionsFromAnswers } from "@/lib/omr/key-sections";
import { canonicalSheet } from "@/lib/omr/sheet";
import { marksForLayout } from "@/lib/omr/key-sections";
import type { FormKind } from "@/lib/omr/types";

const PAGE = { w: 595, h: 842 };

it("dump sections + marks mã đề 745", () => {
  const buf = readFileSync("public/templates/Dap_an_excel_app_QM_2025.xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  const res = parseQm2025Rows(rows, "QM_A4", 96);
  const sections = Object.fromEntries(
    res.keys.map((k) => [k.code, sectionsFromAnswers(k.answers, "QM_A4", 96)]),
  );
  writeFileSync("tests/fixtures/key-sections-745.json", JSON.stringify(sections, null, 1));

  const marks: Record<string, { form: string; x: number; y: number }[]> = {};
  for (const form of ["QM_A4", "GIAY10_11"] as FormKind[]) {
    const layout = canonicalSheet({
      ansNumber: 0,
      optionsPerQuestion: 4,
      form,
      useExamCode: true,
      useStudentCode: true,
    });
    marks[form] = marksForLayout(layout, sections["745"], {
      examCode: "745",
      studentCode: "006400",
    }).map((m) => ({
      form: m.kind,
      x: +(m.bubble.x * PAGE.w).toFixed(2),
      y: +(m.bubble.y * PAGE.h).toFixed(2),
    }));
  }
  writeFileSync("/tmp/overlay-marks.json", JSON.stringify(marks, null, 1));
  console.log("codes:", res.codes.join(","), "marks:", Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v.length])));
});
