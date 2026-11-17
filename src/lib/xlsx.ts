/** Spreadsheet helpers (SheetJS) — CSV and XLSX answer-key import. */

import { lettersToAnswers, normalizeExamCode } from "./sharecode";

export interface ParsedKey {
  name: string;
  answers: number[];
}

/**
 * Parse a workbook/CSV into answer keys.
 *
 * Expected sheet shape (as in the Android app):
 *   row 0: [tên mã đề] then one column per question, cells holding A/B/C/D
 *          (or the header may instead be question numbers).
 *   Each following row: one question, columns are the options for that key.
 *
 * Also supports the transposed layout used by many teachers:
 *   row 0: "Mã đề", question headers "1".."N"
 *   row 1+: exam code in column 0, answer letters per question.
 *
 * The parser auto-detects which layout it is looking at.
 */
export function parseWorkbookRows(rows: unknown[][]): ParsedKey[] {
  const grid = rows
    .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c.length > 0));
  if (grid.length === 0) return [];

  /**
   * Nhận dạng bố cục "transposed" (mỗi HÀNG là một mã đề): hàng đầu là
   * ["Mã đề", 101, 102…] và các hàng sau bắt đầu bằng mã đề.
   *
   * Điều kiện cũ `grid.length > 2` đòi ≥2 hàng dữ liệu → file CHỈ CÓ MỘT mã
   * đề rơi vào nhánh "vertical", đọc tiêu đề "Mã đề" thành mã "001" và tạo
   * một đáp án toàn -1, có thể GHI ĐÈ đáp án 001 thật. Chỉ cần ≥1 hàng dữ liệu.
   * Mã đề dạng "101.0"/"101 " cũng phải nhận (normalizeExamCode hỗ trợ).
   */
  const header = grid[0];
  const numericHeaders = header.slice(1).filter((h) => /^\d+(\.0+)?$/.test(h.trim())).length;
  const firstColCodes = grid
    .slice(1)
    .filter((r) => /^\d{1,4}(\.0+)?$/.test((r[0] ?? "").trim())).length;

  if (numericHeaders >= 2 && grid.length > 1 && firstColCodes >= 1) {
    // Transposed: each data row is a full key.
    const keys: ParsedKey[] = [];
    for (const row of grid.slice(1)) {
      const raw = (row[0] ?? "").trim();
      // Chỉ nhận hàng có CỘT ĐẦU là mã đề (chữ số). Hàng ghi chú/footer ở cuối
      // sheet trước đây bị normalize thành "001" và ghi đè đáp án 001 thật.
      if (!/^\d{1,4}(\.0+)?$/.test(raw)) continue;
      const code = normalizeExamCode(raw);
      const answers = lettersToAnswers(row.slice(1));
      // Hàng toàn ô trống không phải một đáp án.
      if (answers.some((a) => a >= 0)) keys.push({ name: code, answers });
    }
    return keys;
  }

  // Vertical layout: one row per question; column 0 of row 0 is the key name.
  const keyName = normalizeExamCode(header[0] || "001");
  const answers: number[] = [];
  for (const row of grid.slice(1)) {
    // Take the first non-empty cell as the answer letter.
    const cell = row.find((c) => c.length > 0) ?? "";
    const idx = cell.toUpperCase().charCodeAt(0) - 65;
    // Chỉ A–D hợp lệ (phiếu 4 lựa chọn); "E".."Z" là lỗi dữ liệu → -1, nếu
    // không sẽ tạo đáp án 4..25 mà reader không bao giờ khớp.
    answers.push(idx >= 0 && idx < 4 ? idx : -1);
  }
  if (answers.length === 0) return [];
  return [{ name: keyName, answers }];
}

/** Read an .xlsx/.xls/.csv File into answer keys. */
export async function parseKeyFile(file: File): Promise<ParsedKey[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return parseWorkbookRows(rows);
}

/** Build a CSV template for manual filling. */
export function buildKeyTemplate(ansNumber: number, codes: string[] = ["001"]): string {
  const header = ["Mã đề", ...Array.from({ length: ansNumber }, (_, i) => String(i + 1))];
  const lines = [header.join(",")];
  for (const code of codes) {
    lines.push([code, ...Array.from({ length: ansNumber }, () => "A")].join(","));
  }
  return lines.join("\n");
}
