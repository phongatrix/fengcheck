/**
 * Số báo danh trên ảnh chụp thật (mẫu QM 2025 A4).
 *
 * Ảnh gốc: /home/dell/Documents/tulieuchambai/Thu/12a7/IMG_20261106_0907xx.jpg
 * (cùng lô ảnh với phiếu đã tô mã đề 231476). Fixture .gray được tạo bằng
 * scripts/make-sbd-fixtures.mjs để test chạy không cần sharp.
 *
 * Điều kiện đã kiểm: khung giấy trên các ảnh này chạm mép ảnh nên detectPaperQuad
 * trả về cả khung hình; nhờ tìm 4 marker in sẵn trực tiếp (detectMarkerQuadGlobally)
 * + hiệu chỉnh lưới cột chữ số, SBD mới đọc được.
 */
import { existsSync, readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { processGray } from "@/lib/omr/pipeline";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/${name}.gray`);
  return { width: meta.w, height: meta.h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) };
}

const form: FormConfig = {
  ansNumber: 0,
  optionsPerQuestion: 4,
  form: "QM_A4",
  useExamCode: true,
  useStudentCode: true,
};

const CASES: { file: string; sbd: string }[] = [
  { file: "real-qma4-a", sbd: "231476" },
  { file: "real-qma4-b", sbd: "231487" },
  { file: "real-qma4-c", sbd: "231341" },
];

for (const c of CASES) {
  it(`đọc SBD ${c.sbd} từ ảnh chụp thật`, { skip: !existsSync(`tests/fixtures/${c.file}.gray`) }, () => {
    const res = processGray(loadGray(c.file), { form, checkSharpness: false });
    expect(res.ok).toBe(true);
    console.log(`${c.file}: exam ${res.examCode}, SBD ${res.studentCode}`);
    expect(res.studentCode).toBe(c.sbd);
  });
}
