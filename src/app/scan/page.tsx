"use client";

/**
 * Màn hình chụp bài: camera preview + frame định vị theo template,
 * tự động warp → đọc đáp án → chấm điểm khi đủ 4 góc marker và ảnh nét.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import ScanOverlay from "@/components/scan-overlay";
import { useOmrScanner } from "@/hooks/use-omr-scanner";
import { useAppSettings } from "@/hooks/use-app-settings";
import { addScore, listKeys, listQuizzes, saveBlob } from "@/lib/store";
import { gradeConfigOf } from "@/lib/points";
import { canonicalSheet } from "@/lib/omr/sheet";
import { p3ValueOf } from "@/lib/omr/giay-layouts";
import { type FormConfig, type FormKind } from "@/lib/omr/types";
import type { QuizRecord } from "@/lib/db";

function formOf(q: QuizRecord): FormConfig {
  return {
    ansNumber: q.ansNumber,
    optionsPerQuestion: 4,
    form: (q.form as FormKind) || "A4",
    useExamCode: true,
    useStudentCode: q.stdCode,
  };
}

export default function ScanPage() {
  const { settings, update } = useAppSettings();
  const quizzes = useLiveQuery(() => listQuizzes(), []);
  const activeQuizId = settings.activeQuizId;
  const quiz = useMemo(
    () => quizzes?.find((q) => q.id === activeQuizId) ?? quizzes?.[0],
    [quizzes, activeQuizId],
  );
  const keys = useLiveQuery(() => (quiz?.id ? listKeys(quiz.id) : Promise.resolve([])), [quiz?.id], []);

  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const form = useMemo(() => (quiz ? formOf(quiz) : null), [quiz]);
  const layout = useMemo(() => canonicalSheet(form ?? DEFAULT_FORM), [form]);
  const grade = useMemo(() => {
    if (!quiz) return null;
    return gradeConfigOf(quiz, layout, { isSplit: quiz.isSplit, defaultMax: settings.maxScore });
  }, [quiz, layout, settings.maxScore]);

  const scanner = useOmrScanner({
    form: form ?? DEFAULT_FORM,
    keys: keys?.map((k) => ({ code: k.name, answers: k.answers })) ?? null,
    grade,
    autoScan: settings.autoScan,
    cooldownMs: settings.cooldownMs,
    sound: settings.sound,
  });

  const result = scanner.result;
  /** Số câu bỏ trống / tô đè trên phiếu vừa chấm — hiện trong thẻ kết quả. */
  const warnings = useMemo(() => {
    if (!result) return { blank: 0, multi: 0, total: 0 };
    /**
     * Chỉ đếm ô CÂU HỎI TRẮC NGHIỆM (PHẦN I + PHẦN II) — ô chữ số PHẦN III
     * và ô dấu (− / dấu thập phân) KHÔNG bắt buộc tô nên đứng trống là bình
     * thường; trước đây cộng hết vào "bỏ trống" nên phiếu tô đủ vẫn báo thiếu.
     */
    const layoutKind = (result.layoutKind ?? form?.form ?? "QM_A4") as never;
    const readLayout = canonicalSheet({ ...(form ?? DEFAULT_FORM), form: layoutKind });
    const qCount = readLayout.questions.length;
    let blank = 0;
    let multi = 0;
    for (let i = 0; i < Math.min(qCount, result.answers.length); i++) {
      const a = result.answers[i];
      if (a === -1) blank++;
      else if (a === -2) multi++;
    }
    return { blank, multi, total: Math.min(qCount, result.answers.length) };
  }, [result, form]);

  /**
   * Mã đợt chấm: mỗi LƯỢT upload ảnh / một buổi chấm liên tục dùng chung một
   * mã, để trang Kết quả tách đợt đúng (hai lượt upload trong cùng ngày vẫn là
   * hai đợt). Mã mới sinh khi: lượt upload mới bắt đầu, hoặc chấm lẻ mà lần
   * trước đã cách > 30 phút.
   */
  const sessionRef = useRef<{ id: string; last: number; quizId: string } | null>(null);
  const sessionIdFor = (fresh: boolean): string => {
    const now = Date.now();
    const cur = sessionRef.current;
    const qid = quiz?.id ?? "";
    // Đổi BÀI THI phải sang đợt mới: nếu dùng lại mã đợt cũ thì trang Kết quả
    // gộp điểm của hai bài khác nhau vào một đợt (xuất ra một file sai tên).
    if (!fresh && cur && cur.quizId === qid && now - cur.last <= 30 * 60 * 1000) {
      cur.last = now;
      return cur.id;
    }
    const id = `s-${now}-${Math.random().toString(36).slice(2, 8)}`;
    // `fresh` = mã đợt DÙNG MỘT LẦN (lượt upload): KHÔNG lưu vào ref để các
    // lần chấm lẻ sau đó không "dính" vào đợt upload.
    if (!fresh) sessionRef.current = { id, last: now, quizId: qid };
    return id;
  };
  /** Đợt upload vừa chạy không được camera dùng lại — tách hai loại đợt. */
  const endBatchSession = () => {
    sessionRef.current = null;
  };

  /** Lưu một kết quả chấm vào DB (dùng chung cho chấm đơn và chấm hàng loạt). */
  const persistResult = async (
    scan: NonNullable<typeof result>,
    fileName = "",
    opts: { sessionId?: string } = {},
  ) => {
    if (!quiz?.id) return;
    const examCode = scan.matchedCode ?? scan.examCode ?? "";
    const matchedKey = keys?.find((k) => k.name === examCode);
    let imageId: string | undefined;
    let savedName = "";
    if (scan.preview) {
      savedName = fileName || `phieu-${quiz.name}-${Date.now()}.png`;
      const buf = new Uint8Array(await scan.preview.blob.arrayBuffer());
      imageId = await saveBlob(savedName, "image/png", buf);
    }
    await addScore({
      quizId: quiz.id,
      keyCode: matchedKey?.id ?? "",
      examCode,
      fileName: savedName,
      fileNameStudent: scan.studentCode ?? "",
      score: scan.scoreText ?? "",
      stdCode: scan.studentCode ?? "",
      answers: scan.answers,
      ...(scan.codeInferred ? { codeInferred: true } : {}),
      ...(scan.layoutKind ? { layoutKind: scan.layoutKind } : {}),
      type: 0,
      time: Date.now(),
      sessionId: opts.sessionId ?? sessionIdFor(false),
      imageId,
    });
  };

  const save = async (continueScanning: boolean) => {
    if (!result || !quiz?.id) return;
    setSaving(true);
    try {
      await persistResult(result);
      showToast("Đã lưu kết quả bài chấm");
      scanner.acceptResult(); // ở lại màn hình chụp — bản ghi xem ở trang Kết quả
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- Chấm hàng loạt (upload nhiều ảnh) ---------------- */

  type BatchStatus = "pending" | "processing" | "done" | "error";
  interface BatchItem {
    name: string;
    status: BatchStatus;
    score?: string | null;
    exam?: string | null;
    sbd?: string | null;
    error?: string;
    keyFound?: boolean;
  }
  const [batch, setBatch] = useState<{ running: boolean; sessionId: string; items: BatchItem[] } | null>(null);

  const patchItem = (index: number, patch: Partial<BatchItem>) =>
    setBatch((b) =>
      b ? { ...b, items: b.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } : b,
    );

  /**
   * Điểm của một phiếu để hiện trong bảng hàng loạt: ưu tiên dòng "Tong:";
   * bài chấm nhiều phần (gradeAnswers) không có dòng đó → cộng các phần.
   */
  const itemScore = (scan: { scoreLines: string[]; scoreText?: string | null }): string | null => {
    const tong = scan.scoreLines.find((l) => l.startsWith("Tong"));
    if (tong) return tong.replace("Tong:", "").trim();
    const parts = scan.scoreLines
      .map((l) => Number.parseFloat(l.slice(l.lastIndexOf("=") + 1)))
      .filter((v) => Number.isFinite(v));
    return parts.length ? parts.reduce((a, b) => a + b, 0).toFixed(2) : null;
  };

  const runBatch = async (files: File[]) => {
    if (!quiz?.id) {
      showToast("Chọn bài thi trước khi chấm hàng loạt");
      return;
    }
    // Chặn chạy chồng: hai lượt batch cùng lúc sẽ tranh worker và trộn chỉ số.
    if (batch?.running) return;
    // Một lượt upload = MỘT đợt chấm riêng (không gộp với lượt trước dù cùng ngày).
    const batchSession = sessionIdFor(true);
    // Nhả ref NGAY: nếu để nguyên, lệnh "Lưu" tay trong lúc batch chạy sẽ
    // sessionIdFor(false) → nhận đúng mã đợt upload và bị gộp vào đợt đó.
    endBatchSession();
    setBatch({ running: true, sessionId: batchSession, items: files.map((f) => ({ name: f.name, status: "pending" })) });
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      patchItem(i, { status: "processing" });
      try {
        const scan = await scanner.processFile(files[i]);
        await persistResult(scan, `phieu-${quiz.name}-${files[i].name.replace(/\.[^.]+$/, "")}.png`, {
          sessionId: batchSession,
        });
        // Giải phóng blob URL của ảnh đã chấm — batch 200 ảnh giữ 200 PNG trong
        // bộ nhớ suốt phiên nếu không revoke.
        if (scan.preview?.url) URL.revokeObjectURL(scan.preview.url);
        patchItem(i, {
          status: "done",
          score: itemScore(scan),
          exam: scan.matchedCode ?? scan.examCode,
          sbd: scan.studentCode,
          keyFound: scan.keyFound,
        });
        ok++;
      } catch (e) {
        patchItem(i, { status: "error", error: e instanceof Error ? e.message : "Không đọc được phiếu" });
        failed++;
      }
    }
    endBatchSession(); // camera chấm tiếp không dính vào đợt upload này
    setBatch((b) => (b ? { ...b, running: false } : b));
    showToast(`Đã chấm ${ok}/${files.length} ảnh${failed ? ` — ${failed} ảnh lỗi` : ""}`);
  };

  const statusColor =
    scanner.stage === "aligned" || scanner.stage === "result"
      ? "bg-green-600"
      : scanner.stage === "processing"
        ? "bg-brand-600"
        : scanner.stage === "low-sharpness"
          ? "bg-amber-500"
          : scanner.stage === "error"
            ? "bg-red-600"
            : "bg-slate-500";

  return (
    <div className="mx-auto max-w-3xl">
      {/* Quiz selector */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <label className="label mb-1">Bài thi đang chấm</label>
          {quizzes && quizzes.length > 0 ? (
            <select
              className="input"
              value={quiz?.id ?? ""}
              // Khoá khi đang chấm hàng loạt: runBatch giữ quiz lúc bấm chạy, còn
              // processFile đọc opts hiện tại — đổi giữa chừng sẽ chấm bằng bài
              // mới nhưng lưu dưới quiz cũ (bản ghi trộn, không xuất được).
              disabled={!!batch?.running}
              title={batch?.running ? "Đang chấm hàng loạt — đợi xong rồi đổi bài thi" : undefined}
              onChange={(e) => update({ activeQuizId: e.target.value })}
            >
              {quizzes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name} — {q.ansNumber} câu ({q.form})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">
              Chưa có bài thi.{" "}
              <Link href="/keys" className="font-medium text-brand-600 hover:underline">
                Tạo bài thi + nhập đáp án chuẩn →
              </Link>
            </p>
          )}
        </div>
        {quiz && (
          <div className="text-right text-xs text-slate-500">
            <div>
              {keys?.length ?? 0} mã đề trong đáp án chuẩn
            </div>
            {(keys?.length ?? 0) === 0 && (
              <Link href={`/keys/${quiz.id}`} className="font-medium text-amber-600 hover:underline">
                Chưa có đáp án — thêm ngay →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Camera viewport */}
      <div className="card overflow-hidden">
        <div className="relative aspect-video w-full bg-slate-950">
          <video
            ref={scanner.videoRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-contain"
          />
          <ScanOverlay
            frame={scanner.frame}
            quad={scanner.quad}
            stage={scanner.stage}
            aspect={layout.width / layout.height}
            paused={scanner.paused}
          />
          {/* Status pill */}
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
            <span className={`${statusColor} pill text-white shadow`}>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/80" />
              {scanner.status}
            </span>
          </div>
          {!scanner.isCameraActive && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/85 p-6 text-center">
              <div>
                <p className="mb-3 text-sm text-slate-300">
                  {scanner.cameraError ?? "Camera chưa bật"}
                </p>
                <button className="btn-primary" onClick={() => void scanner.startCamera()}>
                  📷 Bật camera
                </button>
                <p className="mt-3 text-xs text-slate-500">
                  Hoặc{" "}
                  <label className="cursor-pointer font-medium text-brand-300 hover:underline">
                    tải ảnh bài làm lên
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void scanner.scanImage(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </p>
              </div>
            </div>
          )}
          {/* Result card overlay */}
          {result && (
            <ResultCard
              result={result}
              layout={layout}
            form={form ?? DEFAULT_FORM}
              saving={saving}
              noQuiz={!quiz}
              warnings={warnings}
              onSave={() => void save(false)}
              onSaveContinue={() => void save(true)}
              onRetry={scanner.retryResult}
            />
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3">
          {scanner.isCameraActive ? (
            <button className="btn-secondary" onClick={scanner.stopCamera}>
              ⏹ Tắt camera
            </button>
          ) : (
            <button className="btn-primary" onClick={() => void scanner.startCamera()}>
              📷 Bật camera
            </button>
          )}
          <button
            className="btn-primary"
            disabled={!scanner.isCameraActive || scanner.processing || !!result}
            onClick={scanner.captureNow}
          >
            ⏺ Chụp ngay
          </button>
          <label className="btn-secondary cursor-pointer">
            📁 Tải ảnh lên
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scanner.scanImage(f);
                e.target.value = "";
              }}
            />
          </label>
          <label className={`btn-secondary cursor-pointer ${batch?.running ? "pointer-events-none opacity-50" : ""}`}>
            🗂 Chấm hàng loạt
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void runBatch(files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={settings.autoScan}
                onChange={(e) => update({ autoScan: e.target.checked })}
              />
              Tự chụp
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={settings.sound}
                onChange={(e) => update({ sound: e.target.checked })}
              />
              Âm thanh
            </label>
          </div>
        </div>
      </div>

      {/* Batch progress panel */}
      {batch && batch.items.length > 0 && (
        <div className="card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-bold text-slate-800">
              Chấm hàng loạt{" "}
              {batch.running && (
                <span className="text-sm font-normal text-slate-500">
                  ({batch.items.filter((i) => i.status === "done").length}/{batch.items.length})
                </span>
              )}
            </h3>
            {!batch.running && (
              <button className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setBatch(null)}>
                ✕ Đóng
              </button>
            )}
          </div>
          <div className="max-h-72 space-y-1 overflow-auto">
            {batch.items.map((item, i) => (
              <div key={`${item.name}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-sm odd:bg-slate-50">
                <span className="w-5 text-center">
                  {item.status === "done" ? "✅" : item.status === "error" ? "❌" : item.status === "processing" ? "⏳" : "•"}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700" title={item.name}>
                  {item.name}
                </span>
                {item.status === "done" && (
                  <span className="shrink-0 text-xs text-slate-500">
                    {item.sbd ? `SBD ${item.sbd}` : "—"} · MĐ {item.exam || "—"} ·{" "}
                    <b className={item.keyFound ? "text-brand-700" : "text-slate-400"}>{item.score ?? "—"}</b>
                  </span>
                )}
                {item.status === "error" && <span className="shrink-0 text-xs text-red-600">{item.error}</span>}
                {item.status === "processing" && <span className="shrink-0 text-xs text-brand-600">đang chấm…</span>}
              </div>
            ))}
          </div>
          {!batch.running && (
            <p className="mt-2 text-xs text-slate-500">
              Đã lưu vào lịch sử — xem chi tiết ở trang Kết quả.
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-center text-xs text-slate-400">
        Căn 4 marker góc phiếu vào khung định vị — hệ thống tự warp perspective, đọc bubble + mã đề
        + SBD rồi chấm điểm. Xem{" "}
        <Link href="/template" className="text-brand-600 hover:underline">
          hướng dẫn in phiếu
        </Link>
        .
      </p>

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg sm:bottom-6">
          {toast}
        </div>
      )}
    </div>
  );
}

const DEFAULT_FORM: FormConfig = {
  ansNumber: 40,
  optionsPerQuestion: 4,
  form: "A4",
  useExamCode: true,
  useStudentCode: true,
};

function ResultCard({
  result,
  layout,
  form,
  saving,
  noQuiz,
  warnings,
  onSave,
  onSaveContinue,
  onRetry,
}: {
  result: ReturnType<typeof useOmrScanner>["result"];
  /** Layout của mẫu đang chấm (bài thi) — dự phòng khi worker không báo mẫu. */
  layout: ReturnType<typeof canonicalSheet>;
  /** Form của bài thi — để dựng layout của MẪU ĐÃ ĐỌC khi ảnh khác mẫu. */
  form: FormConfig;
  saving: boolean;
  noQuiz: boolean;
  warnings: { blank: number; multi: number; total: number };
  onSave: () => void;
  onSaveContinue: () => void;
  onRetry: () => void;
}) {
  if (!result) return null;
  const tongLine = result.scoreLines.find((l) => l.startsWith("Tong"));
  const partLines = result.scoreLines.filter((l) => !l.startsWith("Tong"));
  /**
   * Điểm hiển thị = TỔNG các phần. `gradeAnswers` (bài nhiều phần / chấm từng
   * khối) không phát dòng "Tong:" nên trước đây ô Điểm hiện điểm của PHẦN ĐẦU.
   */
  const partScores = partLines
    .map((l) => Number.parseFloat(l.slice(l.lastIndexOf("=") + 1)))
    .filter((v) => Number.isFinite(v));
  const scoreValue = tongLine
    ? tongLine.replace("Tong:", "").trim()
    : partScores.length
      ? partScores.reduce((a, b) => a + b, 0).toFixed(2)
      : null;
  const counts = partLines.length > 1;
  /**
   * PHẦN III đọc được, dựng lại thành số có dấu ("-1.1", "-2", "22").
   * Dùng layout của MẪU ĐÃ ĐỌC (ảnh có thể là mẫu khác bài thi — tự nhận diện
   * mẫu), không dùng layout của bài thi: offset P3/sign của hai mẫu khác nhau
   * nên đọc bằng layout sai sẽ ra số rác.
   */
  const readLayout = result.layoutKind && result.layoutKind !== layout.kind
    ? canonicalSheet({ ...form ?? DEFAULT_FORM, form: result.layoutKind as never })
    : layout;
  const p3Values = readLayout.part3.length
    ? readLayout.part3.map((_, c) => p3ValueOf(readLayout, result.answers, c)).join("  ")
    : "";
  const p3Any = readLayout.part3.length > 0 && p3Values.replace(/[-\s]/g, "").length > 0;

  return (
    <div className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-slate-950/80 p-3">
      <div className="card w-full max-w-md p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Kết quả chấm</h3>
          <span className="pill bg-slate-100 text-slate-500">
            {result.source === "upload" ? "Ảnh tải lên" : "Webcam"}
          </span>
        </div>

        {result.preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.preview.url}
            alt="Phiếu đã chấm"
            className="mb-3 max-h-56 w-full rounded-lg border border-slate-200 object-contain"
          />
        )}

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2">
            <div className="text-xs text-slate-500">Điểm</div>
            <div className="text-xl font-bold text-brand-700">
              {scoreValue ?? "—"}
            </div>
            {counts && <div className="text-[10px] text-slate-400">{result.scoreLines.length} phần</div>}
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <div className="text-xs text-slate-500">Mã đề</div>
            <div className="text-lg font-semibold">
              {result.matchedCode || result.examCode || "—"}
              {result.codeInferred && (
                <span className="ml-1 align-middle text-[10px] font-medium text-emerald-600" title="Suy ngược từ lưới đáp án">
                  ~
                </span>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <div className="text-xs text-slate-500">SBD</div>
            <div className="text-lg font-semibold">{result.studentCode || "—"}</div>
          </div>
        </div>

        {partLines.length > 0 && (
          <p className="mb-2 text-center text-xs text-slate-500">{partLines.join("  ·  ")}</p>
        )}
        {/* PHẦN III đọc được — hiện đúng dạng số kèm dấu (vd "-1.1", "-2").
            Trước đây chỉ có chuỗi A/B/Đ/S nên không thấy dấu trừ. */}
        {p3Any && (
          <p className="mb-2 rounded-lg bg-slate-50 px-2 py-1.5 text-center font-mono text-xs text-slate-700">
            <span className="mr-1 font-sans font-semibold text-slate-500">PHẦN III:</span>
            {p3Values}
          </p>
        )}
        {(warnings.blank > 0 || warnings.multi > 0) && (
          <p className="mb-2 text-center text-xs text-slate-500">
            Đọc được {warnings.total - warnings.blank - warnings.multi}/{warnings.total} câu
            {warnings.blank > 0 ? ` · ${warnings.blank} bỏ trống` : ""}
            {warnings.multi > 0 ? ` · ${warnings.multi} tô đè` : ""}
          </p>
        )}
        {noQuiz && (
          <p className="mb-2 text-center text-xs text-amber-600">
            Chưa chọn bài thi — chỉ đọc ảnh, không tính điểm.
          </p>
        )}
        {result.codeInferred && result.matchedCode && (
          <p className="mb-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-center text-xs text-emerald-700">
            Ô mã đề không đọc được — <strong>suy ngược từ lưới đáp án</strong>: đề {result.matchedCode}
            {typeof result.codeMatchRatio === "number"
              ? ` (khớp ${Math.round(result.codeMatchRatio * 100)}% ô đáp án)`
              : ""}
          </p>
        )}
        {!noQuiz && !result.keyFound && result.examCode && (
          <p className="mb-2 text-center text-xs text-amber-600">
            Mã đề {result.examCode} chưa có trong đáp án chuẩn — không tính điểm.
          </p>
        )}
        {(result.keyMulti ?? 0) > 0 && (
          <p className="mb-2 text-center text-xs font-semibold text-orange-600">
            ⚠ Tô nhiều đáp án ở{" "}
            {(result.keyMultiList ?? []).length > 0
              ? `câu ${(result.keyMultiList ?? []).join(", ")}`
              : `${result.keyMulti} câu`}{" "}
            — các ý đó không được điểm (ô tô kép khoanh CAM trên ảnh).
          </p>
        )}
        {((result.keyFound ? (result.keyUnsure ?? 0) > 0 : result.questions.some((q) => q.unsure)) ||
          result.readError) && (
          <p className="mb-2 text-center text-xs text-amber-600">
            ⚠ Có câu đọc không chắc (bỏ trống / tô đè / -4) — kiểm tra ảnh trước khi lưu.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          <button className="btn-secondary" onClick={onRetry}>
            ↺ Chụp lại
          </button>
          <button className="btn-secondary" disabled={saving || noQuiz} onClick={onSave}>
            💾 Lưu
          </button>
          <button className="btn-primary" disabled={saving || noQuiz} onClick={onSaveContinue}>
            ⏭ Lưu & chấm tiếp
          </button>
        </div>
      </div>
    </div>
  );
}
