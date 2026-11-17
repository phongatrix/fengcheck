"use client";

/**
 * Ráp đáp án lên CHÍNH mẫu giấy thật.
 *
 * Ảnh nền là trang PDF gốc do trường in (QM_2025_A4_Ky-kiem-tra.pdf /
 * Giay10_11.pdf, render 200 DPI vào public/templates). Dấu đáp án được vẽ
 * bằng toạ độ vector lấy từ chính PDF đó (đơn vị pt, trang 595 × 842), nên
 * dấu nằm đúng tâm ô tròn in sẵn — không phải bản vẽ lại.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { canonicalSheet } from "@/lib/omr/sheet";
import { marksForLayout, type KeySections, type MarkKind } from "@/lib/omr/key-sections";
import type { FormKind } from "@/lib/omr/types";

/**
 * Khổ giấy theo từng mẫu (pt) — KHÔNG dùng chung 595×842: mẫu Mới 2025 in trên
 * 406×600 còn Giấy 12 là 589.6×841.9. Vẽ SVG bằng khổ A4 cho mẫu nhỏ làm toàn
 * bộ vòng dấu lệch/co sai (lưới đáp án không khớp hình).
 */
const PAGE_BY_FORM: Record<string, { w: number; h: number }> = {
  QM_A4: { w: 595, h: 842 },
  GIAY12: { w: 589.61, h: 841.89 },
  GIAY10_11: { w: 595, h: 842 },
  MOI: { w: 406, h: 600 },
};
const pageOf = (form: string) => PAGE_BY_FORM[form] ?? PAGE_BY_FORM.QM_A4;

/**
 * Bán kính ô tròn IN SẴN, đo từ vector PDF (get_drawings → ellipse rect):
 *   QM_A4:      P1/P2 = 4.62pt, P3/MĐ/SBD = 3.78pt
 *   Giấy 10-11: tất cả  = 3.90pt
 * Dấu tô nhỏ hơn 0.35pt để vòng tròn in vẫn nhìn thấy quanh dấu.
 */
const RADIUS_PT: Record<string, Record<MarkKind, number>> = {
  QM_A4: { p1: 4.62, p2: 4.62, p3: 3.78, exam: 3.78, student: 3.78 },
  GIAY12: { p1: 4.19, p2: 4.19, p3: 4.19, exam: 3.96, student: 3.96 },
  GIAY10_11: { p1: 3.9, p2: 3.9, p3: 3.9, exam: 3.9, student: 3.9 },
  MOI: { p1: 2.9, p2: 2.9, p3: 2.0, exam: 2.6, student: 2.6 },
};

const SOURCES: Record<string, { img: string; label: string }> = {
  QM_A4: { img: "/templates/qm-a4.png", label: "QM 2025 — A4 (Kiểm tra)" },
  GIAY12: { img: "/templates/12.png", label: "Giấy 12" },
  GIAY10_11: { img: "/templates/qm-hsg.png", label: "QM 2025 — HSG (Giấy 10-11)" },
  MOI: { img: "/templates/moi.png", label: "Mới 2025 (BGD2025)" },
};

/** Mẫu có ảnh nền PDF gốc để ráp đáp án lên. */
export const OVERLAY_FORMS = Object.keys(SOURCES) as FormKind[];

export function AnswerSheetOverlay({
  form,
  sections,
  examCode,
  studentCode,
  title,
  showCodes = true,
}: {
  form: FormKind;
  sections: KeySections;
  examCode?: string;
  studentCode?: string;
  title?: string;
  showCodes?: boolean;
}) {
  const src = SOURCES[form];
  const [showMarks, setShowMarks] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(
    () =>
      canonicalSheet({
        ansNumber: 0,
        optionsPerQuestion: 4,
        form,
        useExamCode: true,
        useStudentCode: true,
      }),
    [form],
  );

  const marks = useMemo(
    () =>
      marksForLayout(layout, sections, {
        examCode: showCodes ? examCode : undefined,
        studentCode: showCodes ? studentCode : undefined,
      }),
    [layout, sections, examCode, studentCode, showCodes],
  );

  /**
   * Giá trị PHẦN III của đáp án, đọc từ `sections` (nên có dấu "−" đúng như
   * khi nhập/import). Dùng để in chú thích cạnh từng câu: nếu chỉ khoanh ô
   * tròn thì dấu trừ rất khó thấy trong ảnh thu nhỏ.
   */
  const p3Values = useMemo(
    () =>
      layout.part3.map((q, ci) => {
        const digits = sections.p3[ci + 1] ?? [];
        const sign = sections.p3Signs[ci + 1];
        if (!digits.some((d) => d >= 0)) return "-";
        let body = "";
        digits.forEach((d, di) => {
          if (d >= 0) body += String(d);
          if (sign?.comma === di && d >= 0) body += ".";
        });
        if (!body) return "-";
        return sign?.neg ? `-${body}` : body;
      }),
    [layout, sections],
  );

  const download = useCallback(async () => {
    if (!src) return;
    const page = pageOf(form);
    const img = new Image();
    img.src = src.img;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const sx = canvas.width / page.w;
    const sy = canvas.height / page.h;
    for (const m of marks) {
      const cx = m.bubble.x * page.w * sx;
      const cy = m.bubble.y * page.h * sy;
      const r = ((RADIUS_PT[form]?.[m.kind] ?? 4) - 0.35) * sx;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#1d44ad";
      ctx.fill();
      ctx.lineWidth = Math.max(1, 0.5 * sx);
      ctx.strokeStyle = "#1d44ad";
      ctx.stroke();
    }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    const slug = { QM_A4: "qm-a4", GIAY12: "giay-12", GIAY10_11: "qm-hsg", MOI: "moi" } as Record<string, string>;
    a.download = `${slug[form] ?? "phieu"}${examCode ? `-${examCode}` : ""}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [src, marks, form, examCode]);

  if (!src) return null;

  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-slate-700">{src.label}</p>
          <p className="text-[11px] text-slate-500">
            {title ? `${title} · ` : ""}
            {marks.length} dấu đáp án
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />
            Dấu
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            Số câu
          </label>
          <button type="button" className="text-brand-600 hover:underline" onClick={download}>
            Tải PNG
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src.img} alt={src.label} className="block w-full" />
        <svg
          viewBox={`0 0 ${pageOf(form).w} ${pageOf(form).h}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {showMarks &&
            marks.map((m, i) => {
              const cx = m.bubble.x * pageOf(form).w;
              const cy = m.bubble.y * pageOf(form).h;
              const r = (RADIUS_PT[form]?.[m.kind] ?? 4) - 0.35;
              return (
                <g key={`${m.kind}-${m.label}-${i}`}>
                  <circle cx={cx} cy={cy} r={r} fill="#1d44ad" fillOpacity={0.92} />
                  {m.kind === "p2" && (
                    <circle cx={cx} cy={cy} r={r * 0.45} fill="#fff" fillOpacity={0.95} />
                  )}
                  {showLabels && (
                    <text
                      x={cx}
                      y={cy - r - 1.4}
                      textAnchor="middle"
                      fontSize={3.4}
                      fill="#1d44ad"
                      fontWeight="700"
                    >
                      {m.label}
                    </text>
                  )}
                </g>
              );
            })}
          {/* Giá trị PHẦN III ngay dưới mỗi cột số — thấy rõ dấu "−" và dấu
              thập phân của đáp án mà không phải suy từ các ô tròn được tô. */}
          {showMarks &&
            layout.part3.map((q, ci) => {
              const v = p3Values[ci];
              if (v === "-" || !q.columns[0]) return null;
              const x = ((q.columns[0].bubbles[0].x + q.columns[q.columns.length - 1].bubbles[0].x) / 2) * pageOf(form).w;
              const y = q.columns[0].bubbles[q.columns[0].bubbles.length - 1].y * pageOf(form).h + 7;
              return (
                <text
                  key={`p3v-${ci}`}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  fontSize={4}
                  fill="#1d44ad"
                  fontWeight="700"
                >
                  {v}
                </text>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
