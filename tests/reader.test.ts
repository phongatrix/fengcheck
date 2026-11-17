import { describe, expect, it } from "vitest";
import { decideRow, decideRowDual, readDigitColumn, readBubbleRowScores, inkMap } from "@/lib/omr/reader";
import { canonicalSheet } from "@/lib/omr/sheet";
import { createMat } from "@/lib/omr/matrix";
import { renderSheetToGray } from "@/lib/omr/render-sheet";
import { readCanonicalSheet } from "@/lib/omr/reader";
import type { FormConfig } from "@/lib/omr/types";

/** Helper: bubble-box darkness scores for a row rendered on a synthetic sheet. */
function scoresForForm(answers: number[], examCode = "123", studentCode = "456789"): number[][] {
  const form: FormConfig = {
    ansNumber: answers.length,
    optionsPerQuestion: 4,
    form: "A4",
    useExamCode: true,
    useStudentCode: true,
  };
  const gray = renderSheetToGray({ form, answers, examCode, studentCode, paperWidth: 900 });
  const ink = inkMap(gray); // binary foreground map — dark ink is 255
  const layout = canonicalSheet(form);
  const sx = gray.width;
  const sy = gray.height;
  // Same interior sampling as readCanonicalSheet: 60% of the ring radius.
  return layout.questions.map((q) =>
    readBubbleRowScores(
      ink,
      q.bubbles.map((b) => {
        const rr = b.r * Math.min(sx, sy) * 0.6;
        return {
          x: Math.round(b.x * sx - rr),
          y: Math.round(b.y * sy - rr),
          w: Math.max(2, Math.round(2 * rr)),
          h: Math.max(2, Math.round(2 * rr)),
        };
      }),
    ),
  );
}

describe("bubble row decisions", () => {
  it("picks the single filled bubble", () => {
    const rows = scoresForForm([0, 3]);
    const r0 = decideRow(rows[0]);
    expect(r0.answer).toBe(0);
    const r1 = decideRow(rows[1]);
    expect(r1.answer).toBe(3);
  });

  it("marks blank rows as -1", () => {
    const rows = scoresForForm([-1]);
    expect(decideRow(rows[0]).answer).toBe(-1);
  });

  it("marks multi-filled rows as -2", () => {
    const rows = scoresForForm([0]);
    const scores = rows[0].map((v, i) => (i < 2 ? Math.max(v, 0.6) : v));
    expect(decideRow(scores).answer).toBe(-2);
  });

  it("dual strategy flags conflicts on ambiguous rows", () => {
    // Two filled bubbles strongly → -2 and no conflict with the mean strategy.
    const scores = [0.6, 0.6, 0.05, 0.05];
    const r = decideRowDual(scores);
    expect(r.answer).toBe(-2);
  });

  it("ô nhỉnh hơn hẳn nhưng mực mỏng không đủ bằng chứng → trống", () => {
    // Cả hàng bị đẩy nền (vành in lọt vào hộp mẫu): ô "đậm nhất" chỉ 0.36 và
    // chỉ hơn ô thứ hai 1.2 lần — trước đây thành đáp án, nay phải là trống.
    expect(decideRow([0.36, 0.30, 0.28, 0.25]).answer).toBe(-1);
    expect(decideRow([0.31, 0.30, 0.27, 0.26]).answer).toBe(-1);
  });

  it("mực tô nhạt (0.45–0.6) vẫn nhận khi chỉ một ô vượt ngưỡng", () => {
    // Máy quét mờ: ô chọn chỉ 0.50, các ô còn lại dưới ngưỡng 0.3 → vẫn là đáp án.
    expect(decideRow([0.5, 0.28, 0.2, 0.18]).answer).toBe(0);
    // Nhưng 0.35 mà ô kề 0.28 (tỉ lệ 1.25) thì chưa đủ chắc → trống.
    expect(decideRow([0.35, 0.28, 0.2, 0.18]).answer).toBe(-1);
  });

  it("mực mỏng NHƯNG bỏ xa phần còn lại thì vẫn nhận", () => {
    // 0.38 với ô thứ hai 0.10 (tỉ lệ 3.8): vết tô nhạt nhưng rõ ràng duy nhất.
    expect(decideRow([0.1, 0.38, 0.12, 0.09]).answer).toBe(1);
  });
});

describe("digit columns", () => {
  it("reads exam and student codes from a synthetic sheet", () => {
    const form: FormConfig = {
      ansNumber: 10,
      optionsPerQuestion: 4,
      form: "A4",
      useExamCode: true,
      useStudentCode: true,
    };
    const gray = renderSheetToGray({
      form,
      answers: Array(10).fill(1),
      examCode: "042",
      studentCode: "123456",
      paperWidth: 1000,
    });
    const layout = canonicalSheet(form);
    const read = readCanonicalSheet(gray, layout, {
      readExamCode: true,
      readStudentCode: true,
      strict: false,
    });
    expect(read.examCode).toBe("042");
    expect(read.studentCode).toBe("123456");
  });

  it("returns -1 for an unreadable digit", () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({ x: 0, y: i * 10, w: 10, h: 10 }));
    const mat = createMat(10, 100, 255); // uniform white → nothing filled
    expect(readDigitColumn(mat, boxes)).toBe(-1);
  });
});
