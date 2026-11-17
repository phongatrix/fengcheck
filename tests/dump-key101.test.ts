/**
 * Dump đáp án key 101 (k10dapan) ra fixture — dùng để tô scan mẫu moi
 * trong scripts/make-realistic-scans.py và làm expected cho verify-moi-scan.
 * Chạy: npx vitest run tests/dump-key101.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import * as XLSX from "xlsx";
import { parseSmarttestRows } from "@/lib/smarttest-import";

it("dump k10 key 101 answers", () => {
  const buf = readFileSync("public/templates/k10dapanSmarttest2025.xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  const res = parseSmarttestRows(rows, "MOI", 68);
  const k101 = res.keys.find((k) => k.code === "101");
  writeFileSync(
    "tests/fixtures/key101.json",
    JSON.stringify({ code: "101", answers: k101?.answers ?? [] }),
  );
  console.log("dumped key101:", JSON.stringify(k101?.answers.slice(0, 20)));
});
