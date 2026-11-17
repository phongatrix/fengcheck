"use client";

/**
 * Tạo & in mẫu phiếu trả lời (template) khớp 1:1 với bộ detect OMR.
 *
 * Danh sách mẫu lưu trong DB (`templates`) nên THÊM / XOÁ / ẨN được:
 *  - mẫu giấy chuẩn (`builtin`): hiện QM_A4 (nhãn "QM 2025 — A4 (Kiểm tra)",
 *    người dùng có thể đổi tay) và "Giấy khối 10 - 11" (GIAY10_11); GIAY12
 *    ("Giấy khối 12") + MOI vẫn giữ trong DB nhưng không hiện (lọc ở
 *    `listTemplates`);
 *  - mẫu tự thiết kế (A4/A6/A8, số câu tuỳ ý) thêm/xoá tự do.
 */

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { buildSheetSvg } from "@/lib/template";
import { FORM_LABELS, type FormKind } from "@/lib/omr/types";
import {
  deleteTemplate,
  ensureTemplates,
  listTemplates,
  saveTemplate,
  setTemplateHidden,
  setTemplateName,
} from "@/lib/store";
import type { PaperTemplateRecord } from "@/lib/db";

/** Mẫu giấy có file PDF gốc của nhà trường — in thẳng từ PDF đó. */
const SHARED_PDF: Partial<Record<string, { img: string; pdf: string }>> = {
  QM_A4: { img: "/templates/qm-a4.png", pdf: "/templates/QM_2025_A4_Ky-kiem-tra.pdf" },
  GIAY10_11: { img: "/templates/qm-hsg.png", pdf: "/templates/Giay10_11.pdf" },
};

const CUSTOM_FORMS: FormKind[] = ["A4", "A6", "A8"];
const SIZES = ["A4", "A6", "A8"] as const;

export default function TemplatePage() {
  const templates = useLiveQuery(() => listTemplates(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Tạo 4 mẫu chuẩn MỘT LẦN khi mở trang (không ghi DB trong live query).
  useEffect(() => {
    void ensureTemplates();
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  /** Mẫu đang xem: mẫu được chọn, hoặc mẫu đầu tiên chưa ẩn. */
  const current =
    templates?.find((t) => t.id === selectedId) ??
    templates?.find((t) => !t.hidden) ??
    templates?.[0] ??
    null;

  const flash = (kind: "ok" | "err", text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const svg = useMemo(() => {
    if (!current) return "";
    const form = current.form as FormKind;
    return buildSheetSvg({
      form: {
        ansNumber: current.ansNumber,
        optionsPerQuestion: 4,
        form,
        useExamCode: true,
        useStudentCode: form !== "GIAY10_11" && form !== "MOI",
      },
      quizName: current.title,
    });
  }, [current]);

  const shared = current ? SHARED_PDF[current.form] : undefined;

  const downloadSvg = () => {
    if (!current) return;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const slug =
      current.form.startsWith("GIAY") || current.form === "MOI"
        ? current.form.toLowerCase()
        : `${current.size.toLowerCase()}-${current.ansNumber}cau`;
    a.download = `phieu-${slug}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const removeTemplate = async (t: PaperTemplateRecord) => {
    if (!t.id) return;
    if (t.builtin) {
      flash("err", "Mẫu giấy chuẩn không xoá được — dùng “Ẩn” nếu không muốn in");
      return;
    }
    if (!confirm(`Xoá mẫu phiếu “${t.name}”?\nChỉ xoá mẫu in, không ảnh hưởng bài thi/đáp án đã lưu.`)) return;
    setBusy(true);
    try {
      const res = await deleteTemplate(t.id);
      if (!res.ok) flash("err", res.error ?? "Xoá thất bại");
      else {
        flash("ok", `Đã xoá mẫu “${t.name}”`);
        if (selectedId === t.id) setSelectedId(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (t: PaperTemplateRecord) => {
    if (!t.id) return;
    await setTemplateHidden(t.id, !t.hidden);
    flash("ok", t.hidden ? `Đã hiện lại mẫu “${t.name}”` : `Đã ẩn mẫu “${t.name}”`);
  };

  /* ---------------- Đổi tên mẫu (sửa tại chỗ) ---------------- */

  /** Id mẫu đang sửa tên (null = không sửa) + giá trị đang gõ. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (t: PaperTemplateRecord) => {
    if (!t.id) return;
    setRenaming(t.id);
    setRenameValue(t.name);
  };

  const commitRename = async (t: PaperTemplateRecord) => {
    if (!t.id) return;
    const next = renameValue.trim();
    // Tên rỗng hoặc không đổi: đóng ô sửa, không ghi DB.
    if (!next || next === t.name) {
      setRenaming(null);
      return;
    }
    await setTemplateName(t.id, next);
    setRenaming(null);
    flash("ok", `Đã đổi tên mẫu thành “${next}”`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold">Mẫu phiếu & hướng dẫn</h1>
      <p className="mb-4 text-sm text-slate-500">
        Mẫu phiếu được sinh từ cùng bộ tọa độ mà bộ detect sử dụng — in đúng tỷ lệ thì marker và
        bubble luôn khớp khung định vị.
      </p>

      {message && (
        <p
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Danh sách mẫu: chọn để xem/in; ẩn hoặc xoá */}
      <section className="card mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Danh sách mẫu phiếu</h2>
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            + Thêm mẫu phiếu
          </button>
        </div>

        {templates === undefined ? (
          <p className="text-sm text-slate-400">Đang tải...</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {templates.map((t) => (
              <li
                key={t.id}
                className={`flex flex-wrap items-center gap-2 px-1 py-2 text-sm ${t.hidden ? "opacity-50" : ""}`}
              >
                {renaming === t.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      className="input min-w-0 flex-1 py-1"
                      value={renameValue}
                      autoFocus
                      maxLength={80}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(t);
                        else if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <button className="btn-primary px-2 py-1 text-xs" onClick={() => void commitRename(t)}>
                      Lưu
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setRenaming(null)}>
                      Hủy
                    </button>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <button
                      className={`min-w-0 flex-1 text-left ${
                        current?.id === t.id ? "font-semibold text-brand-700" : "text-slate-700"
                      }`}
                      onClick={() => setSelectedId(t.id ?? null)}
                    >
                      {t.name}
                      {t.builtin && (
                        <span className="ml-2 pill bg-slate-100 text-[10px] text-slate-500">chuẩn</span>
                      )}
                      {t.hidden && (
                        <span className="ml-2 pill bg-amber-100 text-[10px] text-amber-700">đang ẩn</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">
                        {t.size} · {t.ansNumber} câu
                      </span>
                    </button>
                    <button
                      className="btn-ghost shrink-0 px-1 py-0.5 text-xs text-slate-400 hover:text-brand-700"
                      title="Đổi tên mẫu phiếu"
                      onClick={() => startRename(t)}
                    >
                      ✏️
                    </button>
                  </div>
                )}
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void toggleHidden(t)}>
                  {t.hidden ? "Hiện" : "Ẩn"}
                </button>
                <button
                  className="btn-ghost px-2 py-1 text-xs text-red-600 disabled:opacity-40"
                  disabled={busy || t.builtin}
                  title={t.builtin ? "Mẫu chuẩn không xoá được" : "Xoá mẫu phiếu"}
                  onClick={() => void removeTemplate(t)}
                >
                  🗑 Xoá
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showForm && (
        <TemplateForm
          onCancel={() => setShowForm(false)}
          onSaved={(t) => {
            setShowForm(false);
            setSelectedId(t.id ?? null);
            flash("ok", `Đã thêm mẫu “${t.name}”`);
          }}
          onError={(e) => flash("err", e)}
        />
      )}

      {current && (
        <>
          <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-48 flex-1">
              <div className="label">Đang xem</div>
              <p className="font-semibold text-slate-800">{current.name}</p>
              <p className="text-xs text-slate-500">
                {current.size} · {current.ansNumber} câu ·{" "}
                {FORM_LABELS[current.form as FormKind] ?? current.form}
              </p>
            </div>
            <button className="btn-secondary" onClick={downloadSvg} disabled={!!shared}>
              ⬇ Tải SVG
            </button>
            {shared ? (
              <a className="btn-primary" href={shared.pdf} download>
                ⬇ Tải PDF gốc
              </a>
            ) : (
              <button className="btn-primary" onClick={() => window.print()}>
                🖨 In phiếu
              </button>
            )}
          </div>

          <div className="card mb-6 overflow-auto p-3">
            {shared ? (
              <div className="mx-auto w-full max-w-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shared.img}
                  alt={current.name}
                  className="w-full rounded border border-slate-200 bg-white shadow-sm"
                />
              </div>
            ) : (
              <div
                id="print-area"
                className="mx-auto w-full max-w-md border border-slate-200 bg-white shadow-sm [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            )}
          </div>

          {shared && (
            <p className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
              Đây là <b>đúng file PDF nhà trường in</b> — tải PDF gốc và in với scale{" "}
              <b>100% / Actual size</b>. Bộ nhận dạng dùng chính toạ độ vector của file này nên
              đọc đúng 100%. Cùng một mã đề ráp được lên cả các mẫu dùng chung.
            </p>
          )}
        </>
      )}

      <section className="card mb-4 p-5">
        <h2 className="mb-2 font-bold">Hướng dẫn in phiếu</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Chọn mẫu phiếu khớp với bài thi đã tạo ở mục “Đáp án”.</li>
          <li>
            Bấm “In phiếu” — trong hộp thoại in chọn khổ giấy đúng, scale <b>100% / Actual size</b>{" "}
            (không “Fit to page”).
          </li>
          <li>In đen trắng là đủ: marker góc, vạch đăng ký cạnh và vòng tròn đáp án phải nét đậm.</li>
          <li>Phóng to kiểm tra: 4 ô vuông đen ở 4 góc phải nguyên vẹn, không bị mờ/tạt mực.</li>
        </ol>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-bold">Quy trình chụp bài</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>
            Chọn bài thi (đã có đáp án chuẩn) ở màn hình <b>Chụp bài</b>.
          </li>
          <li>Đặt phiếu trên nền tối, phẳng, đủ sáng — tránh bóng đổ đè lên marker.</li>
          <li>
            Đưa phiếu vào khung định vị: 4 marker góc nằm tròn 4 ngoặc của khung, viền bóng tối
            không cắt vào phiếu.
          </li>
          <li>
            Giữ máy song song với mặt giấy. Khi đủ 4 góc + ảnh nét, hệ thống <b>tự chụp</b> (tick +
            flash xanh).
          </li>
          <li>
            Kiểm tra điểm/mã đề/mã SV trong thẻ kết quả → <b>Lưu</b> hoặc <b>Lưu & chấm tiếp</b> cho
            phiếu kế tiếp.
          </li>
          <li>Phiếu mờ, góc thiếu hoặc tô đè sẽ báo lỗi: chụp lại hoặc dùng “Tải ảnh lên”.</li>
        </ol>
      </section>
    </div>
  );
}

/** Form thêm mẫu phiếu tự thiết kế (khổ A4/A6/A8, số câu tuỳ ý). */
function TemplateForm({
  onCancel,
  onSaved,
  onError,
}: {
  onCancel: () => void;
  onSaved: (t: PaperTemplateRecord) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("Phiếu tự thiết kế");
  const [size, setSize] = useState<(typeof SIZES)[number]>("A4");
  const [form, setForm] = useState<FormKind>("A4");
  const [ansNumber, setAnsNumber] = useState(40);
  const [title, setTitle] = useState("PHIẾU TRẢ LỜI TRẮC NGHIỆM");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      onError("Đặt tên cho mẫu phiếu");
      return;
    }
    if (!Number.isFinite(ansNumber) || ansNumber < 4 || ansNumber > 240) {
      onError("Số câu phải trong khoảng 4–240");
      return;
    }
    setBusy(true);
    try {
      const rec = await saveTemplate({
        name: n,
        form,
        size,
        ansNumber: Math.round(ansNumber),
        title: title.trim() || "PHIẾU TRẢ LỜI TRẮC NGHIỆM",
        builtin: false,
        hidden: false,
      });
      onSaved(rec);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Không lưu được mẫu phiếu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mb-4 p-4">
      <h2 className="mb-3 font-bold">Thêm mẫu phiếu</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Tên mẫu</label>
          <input
            className="input"
            value={name}
            placeholder="VD: Phiếu 50 câu A4"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Khổ giấy</label>
          <select
            className="input"
            value={size}
            onChange={(e) => {
              const v = e.target.value as (typeof SIZES)[number];
              setSize(v);
              setForm(v as FormKind);
            }}
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Số câu</label>
          <input
            className="input"
            type="number"
            min={4}
            max={240}
            value={ansNumber}
            onChange={(e) => setAnsNumber(Number(e.target.value) || 40)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Tiêu đề in trên phiếu</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">
          Mẫu tự thiết kế dùng khổ <b>{size}</b>, dựng theo hình học{" "}
          <b>{FORM_LABELS[form]}</b>. Muốn chấm bằng webcam thì tạo bài thi ở mục “Đáp án” với đúng
          loại giấy và cùng số câu — phiếu in ra sẽ khớp bộ nhận dạng.
        </p>
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
          Lưu mẫu
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Huỷ
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-xs text-slate-400">
        {CUSTOM_FORMS.map((f) => (
          <span key={f} className={f === form ? "font-semibold text-slate-600" : ""}>
            {FORM_LABELS[f]}
            {f !== "A8" ? " · " : ""}
          </span>
        ))}
      </div>
    </section>
  );
}
