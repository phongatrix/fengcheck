"use client";

/** Trang đáp án của một bài thi: CRUD mã đề, nhập tay, import CSV/XLSX,
 *  mã chia sẻ, quét QR và chia sẻ QR. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  buildShare,
  deleteKey,
  getQuiz,
  importShareCode,
  listKeys,
  saveKey,
  updateQuiz,
} from "@/lib/store";
import { lettersToAnswers, answersToLetters } from "@/lib/sharecode";
import { buildKeyTemplate } from "@/lib/xlsx";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutOptionCount, layoutQuestionCount, layoutQuestionLabel, layoutSlotLabels, layoutSlotKind, layoutSlotTitle, previewAnswers } from "@/lib/omr/giay-layouts";
import { normalizeKeyLegacy } from "@/lib/omr/key-sections";
import { QrCameraScanner, QrCanvas, downloadQrPng, scanQrFromFile } from "@/components/qr";
import { AnswerSheetOverlay } from "@/components/answer-sheet-overlay";
import { PointsEditor } from "@/components/points-editor";
import { sectionsFromAnswers } from "@/lib/omr/key-sections";
import type { KeyRecord, QuizRecord } from "@/lib/db";
import type { FormKind, SheetLayout } from "@/lib/omr/types";

const LETTERS = ["A", "B", "C", "D"];
const OPTION_LABELS_2 = ["Đ", "S"];

const READY_KEYS = [
  { file: "Dap_an_excel_app_QM_2025.xlsx", label: "QM 2025 — Excel app (000/745/774/836/894)" },
];

/** Xử lý text quét được từ QR: JSON key QM hoặc mã chia sẻ 123456789… */
async function importScannedText(
  quizId: string,
  text: string,
  quiz: QuizRecord,
): Promise<{ ok: boolean; message: string }> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const { parseQmJson } = await import("@/lib/qm2025-import");
    const res = parseQmJson(trimmed, quiz.form as FormKind, quiz.ansNumber);
    if (!res.ok) return { ok: false, message: res.error ?? "QR không hợp lệ" };
    const { importParsedKeys } = await import("@/lib/store");
    const r = await importParsedKeys(
      quizId,
      `qr-${res.codes[0] ?? "key"}.json`,
      res.keys.map((k) => ({ name: k.code, answers: k.answers })),
    );
    return {
      ok: r.ok,
      message: r.ok
        ? `Đã nhập ${r.imported} mã đề từ QR (${res.codes.join(", ")})`
        : r.error ?? "Import thất bại",
    };
  }
  const { importShareCode } = await import("@/lib/store");
  const res = await importShareCode(trimmed, quiz);
  return {
    ok: res.ok,
    message: res.ok ? `Đã nhập ${res.keys?.length ?? 0} mã đề từ mã chia sẻ` : res.error ?? "Lỗi",
  };
}

/** Compact answer string: A-D / Đ,S / PHẦN III giá trị số ("−1.1"), "-" cho trống. */
function answerPreview(answers: number[], layout: SheetLayout | null): string {
  if (!layout) {
    return answers.map((a) => (a < 0 ? "-" : a < 4 ? "ABCD"[a] : a <= 9 ? String(a) : "-")).join("");
  }
  return previewAnswers(answers, layout);
}

/** Option labels for one question (A-D / Đ-S / 0-9). */
function optionLabels(count: number): string[] {
  if (count === 2) return OPTION_LABELS_2;
  if (count === 10) return Array.from({ length: 10 }, (_, i) => String(i));
  return LETTERS.slice(0, count);
}

export default function QuizKeysPage() {
  const params = useParams<{ id: string }>();
  const quizId = params.id;
  const quiz = useLiveQuery(() => getQuiz(quizId), [quizId]);
  const keys = useLiveQuery(() => listKeys(quizId), [quizId]);

  const [editor, setEditor] = useState<{ keyId: string | null; name: string; answers: number[] } | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showQrScan, setShowQrScan] = useState(false);
  const [showQrFile, setShowQrFile] = useState(false);
  const [overlayKey, setOverlayKey] = useState<string>("");
  const [overlaySbd, setOverlaySbd] = useState<string>("");
  const [shareText, setShareText] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Tên bài thi đang sửa tại chỗ (null = không sửa). */
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const shareCode = useMemo(() => {
    if (!quiz || !keys || keys.length === 0) return null;
    return buildShare(keys.map((k) => ({ code: k.name, answers: k.answers })), quiz.ansNumber);
  }, [quiz, keys]);

  /**
   * Cảnh báo CÁC MÃ KHÔNG ĐỒNG NHẤT cấu trúc: đếm số ô có đáp án từng phần
   * (P1 / P2 ý / P3) của từng mã theo layout của bài thi. File đáp án nhập
   * thiếu/thừa hàng (cột lệch nhau, trộn nhiều nguồn) hiện ở đây ngay — nhờ
   * vậy không phải đoán qua mẫu số "x/14", "x/18" lệch nhau giữa các phiếu.
   */
  const keyStructureWarning = useMemo(() => {
    if (!quiz || !keys || keys.length < 2) return null;
    const layout = canonicalSheet({
      ansNumber: quiz.ansNumber,
      optionsPerQuestion: 4,
      form: quiz.form as FormKind,
      useExamCode: true,
      useStudentCode: quiz.stdCode,
    });
    const p1Count = layout.part1Count ?? layout.questions.length;
    const qCount = layout.questions.length;
    const parts = keys.map((k) => {
      const a = k.answers ?? [];
      const def = (from: number, to: number) => {
        let n = 0;
        for (let i = from; i < to && i < a.length; i++) if (a[i] !== undefined && a[i] !== -1) n++;
        return n;
      };
      return { name: k.name, p1: def(0, p1Count), p2: def(p1Count, qCount), p3: def(qCount, a.length) };
    });
    const same = (f: (p: (typeof parts)[number]) => number) => new Set(parts.map(f)).size <= 1;
    if (same((p) => p.p1) && same((p) => p.p2) && same((p) => p.p3)) return null;
    const detail = parts.map((p) => `mã ${p.name}: P1 ${p.p1} câu, P2 ${p.p2} ý, P3 ${p.p3} ô`).join(" · ");
    return `Các mã đề KHÔNG đồng nhất cấu trúc — khi chấm, mẫu số từng phần sẽ khác nhau giữa các phiếu: ${detail}`;
  }, [quiz, keys]);

  const flash = (kind: "ok" | "err", text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 4000);
  };

  /** Lưu tên bài thi mới (tên rỗng / không đổi thì bỏ qua). */
  const saveName = async () => {
    if (!quiz || nameDraft === null) return;
    const next = nameDraft.trim();
    setNameDraft(null);
    if (!next || next === quiz.name) return;
    await updateQuiz(quizId, { name: next });
    flash("ok", `Đã đổi tên thành “${next}”`);
  };

  const layout = useMemo(
    () =>
      quiz
        ? canonicalSheet({
            ansNumber: quiz.ansNumber,
            optionsPerQuestion: 4,
            form: quiz.form as never,
            useExamCode: true,
            useStudentCode: quiz.stdCode,
          })
        : null,
    [quiz],
  );

  const openEditor = (key?: KeyRecord) => {
    if (!quiz || !layout) return;
    // Chuẩn hoá encoding cũ (dấu chấm chiếm ô chữ số) và đủ số Ô DẤU mới.
    const answers = normalizeKeyLegacy([...(key?.answers ?? [])], layout);
    setEditor({ keyId: key?.id ?? null, name: key?.name ?? "", answers });
  };

  const saveEditor = async () => {
    if (!editor || !quiz) return;
    // Giữ nguyên mã đề như nhập (1-4 số) — khớp với lưới mã đề của từng mẫu.
    const name = (editor.name || "001").replace(/\D/g, "").padStart(3, "0").slice(-4);
    // Chặn mã đề TRÙNG: hai bản ghi cùng mã thì worker tra `find(code)` chỉ thấy
    // một, bản còn lại không bao giờ được chấm và sửa nó không có tác dụng.
    const dup = keys?.find((k) => k.name === name && k.id !== editor.keyId);
    if (dup) {
      flash("err", `Mã đề ${name} đã có — dùng mã khác hoặc sửa bản đang có`);
      return;
    }
    await saveKey({
      id: editor.keyId ?? undefined,
      quizId,
      name,
      answers: editor.answers,
    });
    setEditor(null);
    flash("ok", `Đã lưu mã đề ${name}`);
  };

  const importShare = async (raw: string) => {
    if (!quiz) return;
    setBusy(true);
    try {
      const res = await importShareCode(raw.trim(), quiz);
      if (res.ok) {
        flash("ok", `Đã import ${res.keys?.length ?? 0} mã đề từ mã chia sẻ`);
        setShareText("");
      } else flash("err", res.error ?? "Không đọc được mã chia sẻ");
    } finally {
      setBusy(false);
    }
  };

  if (quiz === undefined) {
    return <p className="mx-auto max-w-3xl text-sm text-slate-400">Đang tải...</p>;
  }
  if (!quiz) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="card p-6 text-center text-sm text-slate-500">
          Không tìm thấy bài thi. <Link href="/keys" className="text-brand-600">Về danh sách →</Link>
        </p>
      </div>
    );
  }

  const overlaySection = (() => {
    if (!quiz || !keys || keys.length === 0) return null;
    const key = keys.find((k) => k.id === overlayKey) ?? keys[0];
    // Chuẩn hoá encoding cũ trước khi ráp (dấu chấm chiếm ô chữ số → ô dấu riêng).
    const answers = normalizeKeyLegacy(key.answers, canonicalSheet({
      ansNumber: quiz.ansNumber,
      optionsPerQuestion: 4,
      form: quiz.form as FormKind,
      useExamCode: true,
      useStudentCode: quiz.stdCode,
    }));
    const sections = sectionsFromAnswers(answers, quiz.form as FormKind, quiz.ansNumber);
    const sbd = overlaySbd.replace(/\D/g, "");
    return (
      <div className="card mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label mb-1">Ráp đáp án lên mẫu giấy</label>
            <select className="input w-auto" value={key.id} onChange={(e) => setOverlayKey(e.target.value)}>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  Mã đề {k.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1">Số báo danh (tuỳ chọn)</label>
            <input
              className="input w-36"
              inputMode="numeric"
              maxLength={6}
              placeholder="VD: 006400"
              value={overlaySbd}
              onChange={(e) => setOverlaySbd(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <p className="pb-2 text-xs text-slate-500">
            Ảnh nền là chính file PDF nhà trường in; dấu xanh đặt đúng tâm ô tròn.
          </p>
        </div>
        {/*
          Ráp lên ĐÚNG mẫu giấy của bài thi (trước đây luôn vẽ QM_A4 + Giấy
          10-11, nên bài chấm theo Giấy 12 / Mới 2025 ráp lên hình sai mẫu —
          lưới đáp án lệch hẳn so với hình).
        */}
        <div className="grid gap-4 xl:grid-cols-2">
          <AnswerSheetOverlay
            form={quiz.form as FormKind}
            sections={sections}
            examCode={key.name}
            studentCode={sbd || undefined}
            title={`mã đề ${key.name}`}
          />
          {quiz.form !== "QM_A4" && (
            <AnswerSheetOverlay
              form="QM_A4"
              sections={sections}
              examCode={key.name}
              studentCode={sbd || undefined}
              title={`mã đề ${key.name}`}
            />
          )}
        </div>
      </div>
    );
  })();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href="/keys" className="text-sm text-slate-500 hover:text-brand-600">
          ← Quản lý đáp án
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            {nameDraft === null ? (
              <div className="flex items-center gap-1.5">
                <h1 className="text-xl font-bold">{quiz.name}</h1>
                <button
                  className="btn-ghost px-1 py-0.5 text-sm text-slate-400 hover:text-brand-700"
                  title="Đổi tên bài thi"
                  onClick={() => setNameDraft(quiz.name)}
                >
                  ✏️
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  className="input py-1 text-lg font-bold"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                    else if (e.key === "Escape") setNameDraft(null);
                  }}
                />
                <button className="btn-primary px-2 py-1 text-xs" onClick={() => void saveName()}>
                  Lưu
                </button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setNameDraft(null)}>
                  Hủy
                </button>
              </div>
            )}
            <p className="text-sm text-slate-500">
              {quiz.ansNumber} câu · phiếu {quiz.form} · thang điểm{" "}
              {quiz.points ? quiz.points.partMax.join(" / ") : quiz.pointLadder || (quiz.isSplit ? "từng khối 40 câu × 10" : "10")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => openEditor()}>
              + Thêm mã đề
            </button>
            <button className="btn-secondary" disabled={!shareCode} onClick={() => setShowShare(true)}>
              📱 Chia sẻ QR
            </button>
            <button className="btn-secondary" onClick={() => setShowQrScan(true)}>
              📷 Quét QR
            </button>
            <button className="btn-secondary" onClick={() => setShowQrFile(true)}>
              🖼 QR từ ảnh
            </button>
          </div>
        </div>
      </div>

      {message && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}

      {keyStructureWarning && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ {keyStructureWarning}
        </div>
      )}

      {/* Thiết lập điểm từng phần / từng câu */}
      <PointsEditor quiz={quiz} layout={layout} />

      {/* Import row */}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-64 flex-1">
          <label className="label">Import file CSV / XLSX</label>
          <label className="btn-secondary w-full cursor-pointer">
            📁 Chọn file đáp án (Mã đề,1,2,3… / hàng đầu tiên A-D)
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBusy(true);
                try {
                  const { importKeyFileAuto } = await import("@/lib/store");
                  const res = await importKeyFileAuto(quizId, f);
                  if (res.ok) {
                    const codes =
                      res.mode === "smarttest" && res.codes?.length
                        ? ` (mã đề: ${res.codes.slice(0, 6).join(", ")}${res.codes.length > 6 ? "…" : ""})`
                        : "";
                    flash(
                      "ok",
                      `Import ${res.imported} mã đề${codes}${res.skipped ? `, bỏ ${res.skipped} dòng sai` : ""}${res.duplicate ? `, trùng ${res.duplicate}` : ""}`,
                    );
                  } else flash("err", res.error ?? "Import thất bại");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <button
            className="btn-ghost mt-1 px-0 text-xs text-brand-600"
            onClick={() => {
              const csv = buildKeyTemplate(quiz.ansNumber, ["001"]);
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "mau-dap-an.csv";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            }}
          >
            ⬇ Tải file mẫu CSV
          </button>
        </div>
        <div className="min-w-64 flex-1">
          <label className="label">Mã chia sẻ (chuỗi 123456789…)</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={shareText}
              onChange={(e) => setShareText(e.target.value)}
              placeholder="Dán mã chia sẻ"
            />
            <button className="btn-secondary" disabled={busy || !shareText.trim()} onClick={() => void importShare(shareText)}>
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Đáp án mẫu có sẵn (chambaiV3) */}
      <div className="card mb-4 p-4">
        <label className="label">Nhập nhanh file đáp án mẫu (Smarttest — hàng = câu, cột = mã đề)</label>
        <div className="flex flex-wrap gap-2">
          {READY_KEYS.map((k) => (
            <button
              key={k.file}
              className="btn-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await fetch(`/templates/${k.file}`);
                  if (!res.ok) throw new Error("Không tải được file");
                  const f = new File([await res.blob()], k.file, {
                    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  });
                  const { importKeyFileAuto } = await import("@/lib/store");
                  const r = await importKeyFileAuto(quizId, f);
                  if (r.ok) {
                    flash(
                      "ok",
                      `${k.label}: đã nhập ${r.imported} mã đề${r.codes?.length ? ` (${r.codes.join(", ")})` : ""}`,
                    );
                  } else flash("err", r.error ?? "Import thất bại");
                } catch (e) {
                  flash("err", e instanceof Error ? e.message : "Lỗi nhập file");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          File gốc từ chambaiV3 (data/dapan) — đã kèm sẵn trong app.
        </p>
      </div>

      {overlaySection}


      {/* Keys list */}
      {keys === undefined ? (
        <p className="text-sm text-slate-400">Đang tải...</p>
      ) : keys.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Chưa có mã đề nào. Thêm tay, import file, dán mã chia sẻ hoặc quét QR.
        </div>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="card flex items-center gap-3 p-3">
              <span className="pill bg-brand-50 font-mono text-brand-700">{k.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">
                {answerPreview(k.answers, layout)}
              </span>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => openEditor(k)}>
                ✏️
              </button>
              <button
                className="btn-ghost px-2 py-1 text-sm text-red-600"
                onClick={() => {
                  if (confirm(`Xóa mã đề ${k.name}?`)) void deleteKey(quizId, k.id!);
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Key editor modal */}
      {editor && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-slate-950/70 p-4">
          <div className="card w-full max-w-2xl p-4">
            <div className="mb-3 flex items-center gap-3">
              <h3 className="font-bold">{editor.keyId ? "Sửa mã đề" : "Thêm mã đề"}</h3>
              <input
                className="input w-28 font-mono"
                value={editor.name}
                onChange={(e) => setEditor((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                placeholder="001"
                maxLength={4}
              />
              <div className="ml-auto flex items-center gap-2">
                <input
                  className="input w-64 font-mono text-xs"
                  placeholder="Dán nhanh: ABCDAB…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const raw = (e.target as HTMLInputElement).value;
                      setEditor((prev) => {
                        if (!prev || !layout) return prev;
                        const answers = [...prev.answers];
                        let qi = 0;
                        for (const ch of raw.trim()) {
                          if (qi >= answers.length) break;
                          if (ch === "-" || ch === " ") {
                            qi++;
                            continue;
                          }
                          const kind = layoutSlotKind(layout, qi);
                          const count = layoutOptionCount(layout, qi);
                          let value = -1;
                          if (kind === "signNeg") {
                            // "−" hoặc "N" = tô dấu âm; ký tự khác = bỏ qua ô
                            if (ch === "−" || ch.toUpperCase() === "N") value = 0;
                          } else if (kind === "signComma") {
                            // "1"/"2" = dấu thập phân sau chữ số 1/2
                            if (ch === "1" || ch === "2") value = Number(ch) - 1;
                          } else if (count === 2) {
                            const up = ch.toUpperCase();
                            if (up === "Đ" || up === "D" || up === "T") value = 0; // Đúng
                            else if (up === "S" || up === "F") value = 1; // Sai
                          } else if (count === 10) {
                            if (ch >= "0" && ch <= "9") value = ch.charCodeAt(0) - 48;
                          } else {
                            const idx = ch.toUpperCase().charCodeAt(0) - 65;
                            if (idx >= 0 && idx < count) value = idx;
                          }
                          if (value >= 0) answers[qi] = value;
                          qi++;
                        }
                        return { ...prev, answers };
                      });
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
                <span className="text-xs text-slate-400">Enter để áp dụng</span>
              </div>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 p-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {editor.answers.map((a, i) => {
                  const count = layout ? layoutOptionCount(layout, i) : 4;
                  const labels = layout ? layoutSlotLabels(layout, i) : optionLabels(count);
                  const isSign = layout ? layoutSlotKind(layout, i) === "signNeg" || layoutSlotKind(layout, i) === "signComma" : false;
                  return (
                    <div key={i} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-50" title={layout ? layoutSlotTitle(layout, i) : ""}>
                      <span className="w-8 shrink-0 text-right text-xs text-slate-400">
                        {isSign ? (layout && layoutSlotKind(layout, i) === "signNeg" ? "−" : ",") : `${i + 1}.`}
                      </span>
                      {labels.map((label, oi) => (
                        <button
                          key={label}
                          className={`h-7 rounded text-xs font-semibold transition-colors ${
                            count === 10 ? "w-6" : "w-7"
                          } ${a === oi ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                          onClick={() => {
                            setEditor((prev) => {
                              if (!prev) return prev;
                              const answers = [...prev.answers];
                              answers[i] = a === oi ? -1 : oi;
                              return { ...prev, answers };
                            });
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditor(null)}>
                Hủy
              </button>
              <button className="btn-primary" onClick={() => void saveEditor()}>
                Lưu mã đề
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share QR modal */}
      {showShare && shareCode && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-slate-950/70 p-4">
          <div className="card w-full max-w-sm p-4 text-center">
            <h3 className="mb-1 font-bold">Chia sẻ đáp án qua QR</h3>
            <p className="mb-3 text-xs text-slate-500">
              {keys?.length} mã đề · {quiz.ansNumber} câu — app “Chấm thi” quét mã này để import.
            </p>
            <div className="mb-3 grid place-items-center">
              <QrCanvas text={shareCode} />
            </div>
            <div className="flex justify-center gap-2">
              <button
                className="btn-secondary"
                onClick={() => void downloadQrPng(shareCode, `qr-dap-an-${quiz.name}.png`)}
              >
                ⬇ Tải PNG
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareCode);
                  flash("ok", "Đã copy mã chia sẻ");
                }}
              >
                ⧉ Copy mã
              </button>
              <button className="btn-ghost" onClick={() => setShowShare(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR scanner modal */}
      {showQrScan && (
        <QrCameraScanner
          onClose={() => setShowQrScan(false)}
          onDecode={(text) => {
            setShowQrScan(false);
            if (quiz) {
              void importScannedText(quizId, text, quiz).then((r) =>
                flash(r.ok ? "ok" : "err", r.message),
              );
            }
          }}
        />
      )}

      {/* Import đáp án từ file ảnh QR (QM 2025) */}
      {showQrFile && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-slate-950/70 p-4">
          <div className="card w-full max-w-sm p-4">
            <h3 className="mb-1 font-bold">Nhập đáp án từ ảnh QR</h3>
            <p className="mb-3 text-xs text-slate-500">
              Chọn 1 hoặc nhiều ảnh QR (mỗi ảnh = 1 mã đề). App giải mã JSON key QM 2025.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="btn-primary cursor-pointer">
                📁 Chọn ảnh QR
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (!files.length || !quiz) return;
                    setBusy(true);
                    try {
                      const { scanQrFromFile } = await import("@/components/qr");
                      const results: string[] = [];
                      for (const f of files) {
                        const text = await scanQrFromFile(f);
                        if (!text) {
                          results.push(`${f.name}: không thấy QR`);
                          continue;
                        }
                        const r = await importScannedText(quizId, text, quiz);
                        results.push(`${f.name}: ${r.message}`);
                      }
                      flash(results.every((x) => !x.includes("không")) ? "ok" : "err", results.join(" · "));
                    } catch (err) {
                      flash("err", err instanceof Error ? err.message : "Lỗi đọc ảnh QR");
                    } finally {
                      setBusy(false);
                      setShowQrFile(false);
                    }
                  }}
                />
              </label>
              <button className="btn-ghost" onClick={() => setShowQrFile(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
