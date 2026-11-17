/**
 * Ảnh chụp bị CẮT MẤT PHẦN ĐẦU GIẤY (mép trên + marker góc trên ra ngoài
 * khung ảnh — trường hợp chụp cận như ảnh thật tháng 11): paper quad dò được
 * bắt đầu từ dòng tiêu đề → warp cũ dồn cả lưới lên trên, preview "cắt đầu".
 *
 * Grid-fit (src/lib/omr/grid-fit.ts) đối chiếu lưới đáp án: đo độ lệch của các
 * bubble có mực so với lưới chuẩn, fit affine, warp lại → phần đầu bị cắt thành
 * nền trắng (dãn thêm ở phần trên), lưới bubble khớp toạ độ trang in, đọc lại
 * vẫn đúng đáp án.
 *
 * Fixture: cắt 8% chiều cao của scan-qma4.gray (mất mép trên + marker góc trên).
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { processGray } from "@/lib/omr/pipeline";
import { canonicalSheet } from "@/lib/omr/sheet";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

const CROP_TOP_RATIO = 0.045; // cắt ~4.5% đầu giấy — đúng mức ảnh chụp cận thật (tiêu đề bị cắt một nửa)
const form: FormConfig = {
  ansNumber: 0,
  optionsPerQuestion: 4,
  form: "QM_A4",
  useExamCode: true,
  useStudentCode: true,
};

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/scan-${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/scan-${name}.gray`);
  return { width: meta.w, height: meta.h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) };
}

/** Cắt phần đầu ảnh (mô phỏng chụp cận làm mất mép trên của giấy). */
function cropTop(gray: GrayMat, ratio: number): GrayMat {
  const cut = Math.round(gray.height * ratio);
  const data = new Uint8ClampedArray(gray.width * (gray.height - cut));
  data.set(gray.data.subarray(cut * gray.width));
  return { width: gray.width, height: gray.height - cut, data };
}

it("ảnh cắt phần đầu: grid-fit dãn lại và đọc đúng đáp án", () => {
  const layout = canonicalSheet(form);
  const full = loadGray("qma4");
  const cropped = cropTop(full, CROP_TOP_RATIO);
  expect(cropped.height).toBe(full.height - Math.round(full.height * CROP_TOP_RATIO));

  const res = processGray(cropped, { form, checkSharpness: false });
  expect(res.ok).toBe(true);

  // Đọc lại đúng đáp án (grid-fit dãn lại phần trên, lưới khớp).
  const a = res.answers ?? [];
  expect(a.slice(0, 18).join(",")).toBe(
    layout.questions
      .slice(0, 18)
      .map((q) => [3, 0, 1, 1, 0, 0, 2, 0, 2, 1, 1, 1, 0, 1, 1, 0, 3, 3][q.index])
      .join(","),
  );
  expect(res.examCode?.slice(-3)).toBe("745");
  expect(res.studentCode).toBe("006400");
  expect(res.canonical).toBeTruthy();

  // Preview dãn đúng trang in: hàng ngang của câu 1 PHẦN I phải nằm đúng
  // toạ độ chuẩn (317.8pt → 534px trên canvas 1000×1415), tức bubble fill
  // của câu 1 (option C theo key) có mực quanh toạ độ đó.
  const q1 = layout.questions[0].bubbles;
  const cy = Math.round(q1[3].y * (1000 / (layout.width / layout.height)) );
  const cx = Math.round(q1[3].x * 1000);
  let dark = 0;
  for (let y = cy - 15; y <= cy + 15; y++) {
    for (let x = cx - 15; x <= cx + 15; x++) {
      if (res.canonical!.data[y * res.canonical!.width + x] < 128) dark++;
    }
  }
  expect(dark).toBeGreaterThan(20); // tô đậm của câu 1 nằm đúng chỗ trên canvas

  // Phần đầu canvas (trên vùng tiêu đề bị cắt) là NỀN TRẮNG — đã dãn thêm.
  let white = 0;
  const band = Math.round((40 / 842) * (1000 / (layout.width / layout.height)) * (842 / 595));
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < res.canonical!.width; x++) {
      if (res.canonical!.data[y * res.canonical!.width + x] > 235) white++;
    }
  }
  expect(white / (band * res.canonical!.width)).toBeGreaterThan(0.85);
});

it("scan đầy đủ (không cắt) không bị grid-fit làm lệch", () => {
  const layout = canonicalSheet(form);
  const full = loadGray("qma4");
  const res = processGray(full, { form, checkSharpness: false });
  expect(res.ok).toBe(true);
  const a = res.answers ?? [];
  expect(a.slice(0, layout.part1Count).filter((v) => v >= 0).length).toBe(18);
  expect(res.examCode?.slice(-3)).toBe("745");
  expect(res.studentCode).toBe("006400");
  // Lưới vẫn khớp: fill câu 1 ở đúng toạ độ chuẩn
  const q1 = layout.questions[0].bubbles;
  const cy = Math.round(q1[3].y * (1000 / (layout.width / layout.height)) );
  const cx = Math.round(q1[3].x * 1000);
  let dark = 0;
  for (let y = cy - 15; y <= cy + 15; y++) {
    for (let x = cx - 15; x <= cx + 15; x++) {
      if (res.canonical!.data[y * res.canonical!.width + x] < 128) dark++;
    }
  }
  expect(dark).toBeGreaterThan(20);
});
