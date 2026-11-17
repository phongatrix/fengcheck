"use client";

/** Quản lý đáp án chuẩn: danh sách bài thi + tạo bài thi mới. */

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { createQuiz, deleteQuiz, listKeys, listQuizzes, updateQuiz } from "@/lib/store";
import { db } from "@/lib/db";
import { FORM_LABELS, GIAY_FORMS, type FormKind } from "@/lib/omr/types";
import { canonicalSheet } from "@/lib/omr/sheet";
import { layoutQuestionCount } from "@/lib/omr/giay-layouts";
import { cauCountsOf, giayStandardMaxes } from "@/lib/points";

/**
 * "Loại phiếu" chỉ hiện 2 mẫu giấy nhà trường đang dùng (Giấy khối 10 - 11 và
 * Giấy khối 12). Các loại khác (QM_A4 / MOI / tự thiết kế) vẫn được hỗ trợ khi
 * chấm và in — dữ liệu/bài thi cũ không đổi, chỉ ẩn khỏi ô chọn này.
 */
const FORMS: FormKind[] = ["GIAY10_11", "GIAY12"];

/** Thang điểm gợi ý cho mẫu Giấy — CÙNG công thức cho Giấy 12 và Giấy 10-11. */
function giayLadderFor(form: FormKind): string {
  const layout = canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true });
  const m = giayStandardMaxes(cauCountsOf(layout));
  return `${m.p1},${m.p2},${m.p3}`;
}

/** Total keyable questions for a form (fixed for the two printed templates). */
function formQuestionCount(form: FormKind, ansNumber: number): number {
  if (GIAY_FORMS.includes(form)) {
    return layoutQuestionCount(canonicalSheet({ ansNumber: 0, optionsPerQuestion: 4, form, useExamCode: true, useStudentCode: true }));
  }
  return ansNumber;
}

export default function KeysPage() {
  const quizzes = useLiveQuery(() => listQuizzes(), []);
  const keyCounts = useLiveQuery(
    async () => {
      const keys = await db.keys.toArray();
      const map: Record<string, number> = {};
      for (const k of keys) map[k.quizId] = (map[k.quizId] ?? 0) + 1;
      return map;
    },
    [],
    {} as Record<string, number>,
  );
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [ansNumber, setAnsNumber] = useState(40);
  const [form, setForm] = useState<FormKind>("GIAY12");
  const [stdCode, setStdCode] = useState(true);
  const [isSplit, setIsSplit] = useState(false);
  const [pointLadder, setPointLadder] = useState(giayLadderFor("GIAY12"));
  const [error, setError] = useState<string | null>(null);
  /** Id bài thi đang sửa tên (null = không sửa) + giá trị đang gõ. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const isGiay = GIAY_FORMS.includes(form);
  const effCount = formQuestionCount(form, ansNumber);

  const startRename = (id: string, current: string) => {
    setRenaming(id);
    setRenameValue(current);
  };

  /** Lưu tên mới; tên rỗng hoặc không đổi thì bỏ qua (không ghi DB vô ích). */
  const commitRename = async (id: string, current: string) => {
    const next = renameValue.trim();
    setRenaming(null);
    if (!next || next === current) return;
    await updateQuiz(id, { name: next });
  };

  const submit = async () => {
    if (!name.trim()) return setError("Nhập tên bài thi");
    await createQuiz({
      name: name.trim(),
      ansNumber: effCount,
      form,
      isSplit: isGiay ? false : isSplit,
      pointLadder: pointLadder.trim(),
      stdCode: form === "GIAY10_11" || form === "MOI" ? false : stdCode,
      selectCourses: "",
    });
    setShowForm(false);
    setName("");
    setError(null);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Quản lý đáp án chuẩn</h1>
          <p className="text-sm text-slate-500">Mỗi bài thi chứa các mã đề + đáp án A–D.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          + Tạo bài thi
        </button>
      </div>

      {showForm && (
        <div className="card mb-4 space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Tên bài thi</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Giữa kỳ Toán 10"
              />
            </div>
            <div>
              <label className="label">Loại phiếu</label>
              <select
                className="input"
                value={form}
                onChange={(e) => {
                  const next = e.target.value as FormKind;
                  setForm(next);
                  // Thang điểm mặc định đổi theo mẫu: 3 phần cho mẫu giấy in,
                  // một thang duy nhất cho phiếu tự thiết kế (A4/A6/A8).
                  const nextIsGiay = GIAY_FORMS.includes(next);
                  const ladder = pointLadder.trim();
                  // Mẫu Giấy: thang = P1 0.25đ/câu, P2 1đ/câu, P3 0.5đ/câu (tính
                  // theo số câu của chính mẫu đó — 12 và 10-11 cùng công thức).
                  if (nextIsGiay && (ladder === "" || ladder === "10" || /^\d+(\.\d+)?,\d+(\.\d+)?,0$/.test(ladder))) {
                    setPointLadder(giayLadderFor(next));
                  } else if (!nextIsGiay && (ladder === "" || GIAY_FORMS.some((f) => ladder === giayLadderFor(f)))) {
                    setPointLadder("10");
                  }
                }}
              >
                {FORMS.map((f) => (
                  <option key={f} value={f}>
                    {FORM_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Số câu hỏi</label>
              <input
                className="input"
                type="number"
                min={1}
                max={240}
                value={isGiay ? effCount : ansNumber}
                disabled={isGiay}
                title="Số câu cố định theo mẫu Giấy"
                onChange={(e) => setAnsNumber(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="label">
                {isGiay ? "Thang điểm P1, P2, P3" : "Thang điểm từng phần (tùy chọn)"}
              </label>
              <input
                className="input"
                value={pointLadder}
                onChange={(e) => setPointLadder(e.target.value)}
                placeholder={isGiay ? giayLadderFor(form) : "VD: 4,6 hoặc 10"}
              />
              {isGiay && (
                <p className="mt-1 text-xs text-slate-400">
                  Mặc định: P1 = số câu × 0.25, P2 = 1 điểm/câu, P3 = 0.5 điểm/câu (Giấy 12 và
                  Giấy 10-11 dùng chung công thức). Có thể sửa tay hoặc nhập MỘT số = tổng cả bài.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {!isGiay && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={stdCode} onChange={(e) => setStdCode(e.target.checked)} />
                Có khối mã SV (6 số)
              </label>
            )}
            {form === "GIAY12" && (
              <span className="text-slate-400">Có lưới Số báo danh (8 số) — tự đọc</span>
            )}
            {!isGiay && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={isSplit} onChange={(e) => setIsSplit(e.target.checked)} />
                Chấm từng khối 40 câu (isSplit)
              </label>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setShowForm(false)}>
              Hủy
            </button>
            <button className="btn-primary" onClick={() => void submit()}>
              Lưu bài thi
            </button>
          </div>
        </div>
      )}

      {quizzes === undefined ? (
        <p className="text-sm text-slate-400">Đang tải...</p>
      ) : quizzes.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Chưa có bài thi nào. Bấm “Tạo bài thi” để bắt đầu.
        </div>
      ) : (
        <ul className="space-y-2">
          {quizzes.map((q) => (
            <li key={q.id} className="card flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                {renaming === q.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="input py-1"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(q.id!, q.name);
                        else if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                    <button
                      className="btn-primary px-2 py-1 text-xs"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void commitRename(q.id!, q.name)}
                    >
                      Lưu
                    </button>
                    <button
                      className="btn-ghost px-2 py-1 text-xs"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setRenaming(null)}
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Link href={`/keys/${q.id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                      {q.name}
                    </Link>
                    <button
                      className="btn-ghost px-1 py-0.5 text-xs text-slate-400 hover:text-brand-700"
                      title="Đổi tên bài thi"
                      onClick={() => startRename(q.id!, q.name)}
                    >
                      ✏️
                    </button>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  {q.ansNumber} câu · phiếu {q.form}
                  {q.isSplit ? " · chấm từng khối 40 câu" : ""}
                  {q.pointLadder ? ` · thang ${q.pointLadder}` : ""}
                </p>
              </div>
              <span className="pill bg-brand-50 text-brand-700">{keyCounts?.[q.id ?? ""] ?? 0} mã đề</span>
              <Link href={`/keys/${q.id}`} className="btn-secondary px-3 py-1.5">
                Mở
              </Link>
              <button
                className="btn-ghost px-2 py-1.5 text-red-600"
                title="Xóa bài thi"
                onClick={() => {
                  if (confirm(`Xóa bài thi “${q.name}” cùng toàn bộ đáp án?`)) {
                    void deleteQuiz(q.id!);
                  }
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
