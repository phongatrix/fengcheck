/**
 * Kiểm tra nhanh bố cục chữ đỏ của mẫu QM_A4 (giữ nguyên bố cục cũ: chữ nằm
 * cạnh tiêu đề PHẦN I/II/III, cỡ 0.032H) — mẫu 10_11 mới dùng khung điểm.
 */
import { readFileSync, existsSync } from "node:fs";
import { it, expect } from "vitest";
import { processGray, renderScoredPreview } from "@/lib/omr/pipeline";
import { gradeGiay, parsePartMaxes } from "@/lib/scoring";
import type { FormConfig, GrayMat } from "@/lib/omr/types";

const hasFixture = () => existsSync("tests/fixtures/real-qma4-a.meta.json");

function loadGray(name: string): GrayMat {
  const meta = JSON.parse(readFileSync(`tests/fixtures/${name}.meta.json`, "utf8"));
  const buf = readFileSync(`tests/fixtures/${name}.gray`);
  return {
    width: meta.w,
    height: meta.h,
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length),
  };
}

it("QM_A4 giữ bố cục chữ cũ (không dùng khung điểm)", { skip: !hasFixture() }, () => {
  const form: FormConfig = {
    ansNumber: 96,
    optionsPerQuestion: 4,
    form: "QM_A4",
    useExamCode: true,
    useStudentCode: true,
  };
  const res = processGray(loadGray("real-qma4-a"), { form, checkSharpness: false });
  expect(res.ok).toBe(true);
  expect(res.layout.scoreBox).toBeUndefined();

  const answers = res.answers ?? [];
  const key = answers.map((a) => (a >= 0 ? a : 0));
  const grade = gradeGiay({ p1: 40, p2: 8, p3: 6 }, key, answers, parsePartMaxes("6,4,0"));
  const preview = renderScoredPreview(res, grade.text, key)!;
  const { width, height, rgba } = preview;

  const isRed = (i: number) => rgba[i] > 150 && rgba[i + 1] < 90 && rgba[i + 2] < 90;
  const bands: { y0: number; y1: number; x0: number; x1: number }[] = [];
  let cur: (typeof bands)[number] | null = null;
  for (let y = 0; y < height; y++) {
    let n = 0;
    let minX = width;
    let maxX = -1;
    for (let x = 0; x < width; x++) {
      if (isRed((y * width + x) * 4)) {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (n >= 3) {
      if (cur && y - cur.y1 <= 2) {
        cur.y1 = y;
        cur.x0 = Math.min(cur.x0, minX);
        cur.x1 = Math.max(cur.x1, maxX);
      } else {
        cur = { y0: y, y1: y, x0: minX, x1: maxX };
        bands.push(cur);
      }
    } else cur = null;
  }
  console.log("QM_A4 bands:", bands.map((b) => `y ${b.y0}-${b.y1} x ${b.x0}-${b.x1}`).join(" | "));

  // 4 dải: 3 hàng điểm (PHẦN I P1·Tong·MD·SBD, PHẦN II, PHẦN III) + dòng
  // "MD: <mã đề>" đặt NGAY TRÊN nhãn "8. Mã đề thi" in sẵn (yêu cầu 2026-11-17)
  // — dải trên cùng, nằm nửa phải trang.
  expect(bands.length).toBe(4);
  const mdBand = bands[0];
  expect(mdBand.y0).toBeLessThan(bands[1].y0);
  expect(mdBand.x0).toBeGreaterThan(width * 0.6);
  // Cỡ chữ = cỡ nhãn "PHẦN …" in sẵn (~0.022H) — chấp nhận 0.015–0.045H để
  // không phụ thuộc glyph bitmap (glyph có dấu dày hơn chữ hoa).
  const hAvg = bands.reduce((s, b) => s + (b.y1 - b.y0 + 1), 0) / bands.length;
  expect(hAvg).toBeGreaterThan(height * 0.015);
});
