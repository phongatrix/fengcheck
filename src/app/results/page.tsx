"use client";

/** Lịch sử bài chấm: ảnh annotated + điểm + SBD, xuất gói "ketqua" (xlsx + pdf + zip). */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ScoreRecord } from "@/lib/db";
import { deleteScores, downloadBlobLike, getBlob, listQuizzes } from "@/lib/store";
import { buildKetquaPackage } from "@/lib/export-ketqua";
import { answersToLetters } from "@/lib/sharecode";
import { canonicalSheet } from "@/lib/omr/sheet";
import { previewAnswers } from "@/lib/omr/giay-layouts";
import type { FormKind } from "@/lib/omr/types";
import { groupBySession, sessionLabel, sortBatch } from "@/lib/results-group";

function timeStr(t: number): string {
  return new Date(t).toLocaleString("vi-VN", { hour12: false });
}

type ScoreRow = {
  id?: string;
  quizId: string;
  time: number;
  score?: string;
  examCode?: string;
  codeInferred?: boolean;
  /** Mẫu giấy thực của phiếu đã đọc (khác quiz.form khi worker tự đổi mẫu). */
  layoutKind?: string;
  stdCode?: string;
  /** Mã đợt chấm — mỗi lượt upload nhiều ảnh là một đợt riêng. */
  sessionId?: string;
  imageId?: string;
  answers: number[];
};

export default function ResultsPage() {
  const scores = useLiveQuery(async () => {
    const rows = await db.scores.orderBy("time").reverse().toArray();
    return rows.filter((r) => r.type !== -1);
  }, []);
  const quizzes = useLiveQuery(() => listQuizzes(), []);
  const [filterQuiz, setFilterQuiz] = useState("all");
  const [exporting, setExporting] = useState(false);
  /** Key của đợt đang xoá ("" = không xoá) — khoá nút để không bấm hai lần. */
  const [deleting, setDeleting] = useState("");
  /** true = đang chạy "Xóa tất cả" (tách khỏi `deleting` để không trùng khoá đợt). */
  const [deletingAll, setDeletingAll] = useState(false);

  const filtered = useMemo(() => {
    if (!scores) return [];
    return filterQuiz === "all" ? scores : scores.filter((s) => s.quizId === filterQuiz);
  }, [scores, filterQuiz]);

  /**
   * Chia danh sách thành từng ĐỢT CHẤM: mỗi lượt upload nhiều ảnh (có sessionId)
   * là một đợt; bài chấm lẻ qua camera gộp theo thời gian (≤30 phút).
   * Đợt hiện hành (mới nhất) nằm trên cùng, đợt trước ở dưới.
   */
  const sessions = useMemo(() => groupBySession(filtered, 30 * 60 * 1000), [filtered]);

  /** Toàn bộ bản ghi đã sắp xếp (dùng cho nút Xuất tất cả). */
  const sorted = useMemo(() => sessions.flatMap((g) => sortBatch(g.records)), [sessions]);

  /**
   * "Có điểm" = có chuỗi điểm, không phụ thuộc định dạng: phiếu 3 phần có dòng
   * "Tong:", phiếu một phần chỉ có "8/10=8.00" — trước đây đếm theo "Tong:"
   * nên phiếu một phần luôn hiện 0.
   */
  const hasScore = (s: ScoreRow) => (s.score ?? "").trim().length > 0;

  /** Tên bài thi của một bản ghi ("" khi bài thi đã bị xoá). */
  const quizNameOf = (quizId?: string) => quizzes?.find((q) => q.id === quizId)?.name ?? "—";

  /** Tóm tắt đáp án: PHẦN I/II chữ cái/Đ,S, PHẦN III giá trị số ("-1.1"). */
  const answerBrief = (s: ScoreRow) => {
    const quiz = quizzes?.find((q) => q.id === s.quizId);
    if (!quiz) return answersToLetters(s.answers).join("");
    // `answers` được lưu theo layout ĐÃ ĐỌC (worker có thể tự đổi mẫu) — dùng
    // đúng layout đó, nếu không PHẦN III hiện sai vị trí chữ số/ô dấu.
    const layout = canonicalSheet({
      ansNumber: quiz.ansNumber,
      optionsPerQuestion: 4,
      form: (s.layoutKind ?? quiz.form) as FormKind,
      useExamCode: true,
      useStudentCode: quiz.stdCode,
    });
    return previewAnswers(s.answers, layout);
  };

  /** Xuất gói "ketqua" đúng định dạng app gốc: xlsx + pdf + zip ảnh phiếu. */
  const exportKetqua = async (records: ScoreRecord[], quizName: string) => {
    if (!records.length || exporting) return;
    setExporting(true);
    try {
      const files = await buildKetquaPackage(records, quizName);
      for (const file of files) {
        downloadBlobLike(file, file.mime);
        await new Promise((r) => setTimeout(r, 350)); // trình duyệt cần nhịp giữa các download
      }
    } finally {
      setExporting(false);
    }
  };

  /**
   * "Xuất tất cả": nếu đang xem nhiều bài thi thì xuất RIÊNG từng bài (mỗi bài
   * một bộ file tên riêng) — gộp chung sẽ ra file mang tên một bài nhưng chứa
   * điểm của nhiều bài thi khác nhau.
   */
  const exportAll = async () => {
    if (!sorted.length || exporting) return;
    if (filterQuiz !== "all") {
      await exportKetqua(sorted as ScoreRecord[], quizNameOf(filterQuiz));
      return;
    }
    const byQuiz = new Map<string, ScoreRow[]>();
    for (const r of sorted) {
      const list = byQuiz.get(r.quizId);
      if (list) list.push(r);
      else byQuiz.set(r.quizId, [r]);
    }
    setExporting(true);
    try {
      for (const [quizId, records] of byQuiz) {
        const files = await buildKetquaPackage(records as ScoreRecord[], quizNameOf(quizId));
        for (const file of files) {
          downloadBlobLike(file, file.mime);
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    } finally {
      setExporting(false);
    }
  };

  /**
   * "Xóa tất cả": xoá MỌI bản ghi đang hiển thị (tôn trọng bộ lọc bài thi).
   * Đang lọc một bài thì chỉ xoá bài đó; "Tất cả bài thi" thì xoá hết. Luôn hỏi
   * lại và nêu rõ số phiếu vì thao tác không hoàn tác được.
   */
  const deleteAll = async () => {
    if (deleting || deletingAll) return;
    const ids = sorted.map((r) => r.id).filter((v): v is string => !!v);
    if (!ids.length) return;
    const where = filterQuiz === "all" ? "TOÀN BỘ kết quả chấm" : `toàn bộ kết quả của "${quizNameOf(filterQuiz)}"`;
    if (!confirm(`Xóa ${where}?\n${ids.length} phiếu sẽ bị xoá kèm ảnh đã chấm.\nKhông hoàn tác được.`)) return;
    setDeletingAll(true);
    try {
      await deleteScores(ids);
    } finally {
      setDeletingAll(false);
    }
  };

  /**
   * "Xóa đợt": xoá toàn bộ bài của một đợt chấm (kèm ảnh đã chấm trong DB).
   * Hỏi lại trước khi xoá vì thao tác không hoàn tác được; câu hỏi nêu rõ số
   * phiếu để tránh xoá nhầm đợt khác.
   */
  const deleteSession = async (key: string, records: ScoreRow[]) => {
    if (deleting || deletingAll) return;
    const ids = records.map((r) => r.id).filter((v): v is string => !!v);
    if (!ids.length) return;
    if (!confirm(`Xóa toàn bộ ${ids.length} bài của đợt này?\nKhông hoàn tác được.`)) return;
    setDeleting(key);
    try {
      await deleteScores(ids);
    } finally {
      setDeleting("");
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Kết quả chấm</h1>
          <p className="text-sm text-slate-500">
            {sorted.length} bản ghi · có điểm: {sorted.filter(hasScore).length}
          </p>
        </div>
        <div className="flex gap-2">
          <select className="input w-auto" value={filterQuiz} onChange={(e) => setFilterQuiz(e.target.value)}>
            <option value="all">Tất cả bài thi</option>
            {(quizzes ?? []).map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost text-red-600"
            disabled={!sorted.length || deletingAll}
            onClick={() => void deleteAll()}
            title={
              filterQuiz === "all"
                ? "Xoá TOÀN BỘ kết quả chấm trong máy"
                : `Xoá toàn bộ kết quả của "${quizNameOf(filterQuiz)}"`
            }
          >
            {deletingAll ? "⏳ Đang xoá…" : "🗑 Xóa tất cả"}
          </button>
          <button
            className="btn-primary"
            disabled={!sorted.length || exporting}
            onClick={() => void exportAll()}
          >
            {exporting ? "⏳ Đang xuất…" : "⬇ Xuất tất cả"}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Chưa có bản ghi nào. <Link href="/scan" className="text-brand-600">Chụp bài đầu tiên →</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {sessions.map((session, si) => {
            const records = sortBatch(session.records);
            const withScore = records.filter(hasScore).length;
            const quizName = quizNameOf(records[0].quizId);
            return (
              <section key={session.key} className="card overflow-hidden">
                {/* Tiêu đề đợt chấm */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                      <span>Đợt chấm {sessions.length - si}</span>
                      {si === 0 && (
                        <span className="pill bg-green-100 text-[10px] font-semibold text-green-700">hiện hành</span>
                      )}
                      <span className="font-normal text-slate-600">
                        {sessionLabel(session.start, session.end)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {quizName} · {records.length} phiếu · có điểm: {withScore}
                      {session.batch ? " · một lượt upload" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="btn-ghost px-2 py-1 text-xs text-brand-700"
                      title="Xuất riêng đợt này (xlsx + pdf + zip)"
                      onClick={() => void exportKetqua(records as ScoreRecord[], quizName)}
                    >
                      ⬇ Xuất đợt
                    </button>
                    <button
                      className="btn-ghost px-2 py-1 text-xs text-red-600"
                      title="Xoá toàn bộ bài của đợt này"
                      disabled={deleting === session.key}
                      onClick={() => void deleteSession(session.key, records)}
                    >
                      {deleting === session.key ? "⏳ Đang xoá…" : "🗑 Xóa đợt"}
                    </button>
                  </div>
                </div>
                <ul>
                  {records.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 border-b border-slate-50 px-4 py-3 last:border-b-0">
                      <RecordImageById id={s.imageId} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-semibold text-slate-800">
                            {s.score ? `Điểm ${s.score.replace(/\n/g, " / ")}` : "Không tính điểm"}
                          </span>
                          {s.examCode && (
                            <span
                              className="pill bg-brand-50 font-mono text-brand-700"
                              title={s.codeInferred ? "Mã đề suy ngược từ lưới đáp án" : undefined}
                            >
                              Đề {s.examCode}
                              {s.codeInferred ? " ~" : ""}
                            </span>
                          )}
                          {s.stdCode && <span className="pill bg-slate-100 font-mono text-slate-600">SBD {s.stdCode}</span>}
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {timeStr(s.time)} · {answerBrief(s)}
                        </p>
                      </div>
                      {s.imageId && (
                        <a
                          className="btn-ghost px-2 py-1 text-sm"
                          title="Tải ảnh phiếu"
                          href="#"
                          onClick={async (e) => {
                            e.preventDefault();
                            const blob = await getBlob(s.imageId!);
                            if (!blob) return;
                            const url = URL.createObjectURL(new Blob([blob.data], { type: blob.mime }));
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = blob.name;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 3000);
                          }}
                        >
                          ⬇
                        </a>
                      )}
                      <button
                        className="btn-ghost px-2 py-1 text-sm text-red-600"
                        onClick={() => {
                          if (confirm("Xóa bản ghi này?")) void deleteScores([s.id!]);
                        }}
                      >
                        🗑
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Loads the annotated PNG (blob table) and renders its thumbnail. */
function RecordImageById({ id }: { id?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let created: string | null = null;
    void getBlob(id).then((rec) => {
      if (!alive || !rec) return;
      created = URL.createObjectURL(new Blob([rec.data], { type: rec.mime }));
      setUrl(created);
    });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);
  if (!id) {
    return (
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded bg-slate-100 text-[10px] text-slate-400">
        không ảnh
      </span>
    );
  }
  return (
    <div className="group relative shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Phiếu đã chấm"
          className="h-14 w-14 cursor-zoom-in rounded border border-slate-200 object-cover"
        />
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded bg-slate-100 text-xs text-slate-400">…</span>
      )}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Phiếu đã chấm (phóng to)"
          className="pointer-events-none fixed left-1/2 top-1/2 z-50 hidden max-h-[85vh] max-w-[85vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border-4 border-slate-300 bg-white object-contain shadow-2xl group-hover:block"
        />
      )}
    </div>
  );
}
