"use client";

/** Cài đặt ứng dụng: âm thanh, tự chụp, cooldown, điểm tối đa, dữ liệu. */

import { useState } from "react";
import { useAppSettings } from "@/hooks/use-app-settings";
import { db } from "@/lib/db";
import { BACKUP_URL, exportBackup, restoreFromBackup } from "@/lib/restore";
import { useLiveQuery } from "dexie-react-hooks";

export default function SettingsPage() {
  const { settings, update } = useAppSettings();
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const counts = useLiveQuery(
    async () => ({
      quizzes: await db.quizzes.count(),
      keys: await db.keys.count(),
      scores: (await db.scores.toArray()).filter((s) => s.type !== -1).length,
      blobs: await db.blobs.count(),
    }),
    [],
  );

  const handleRestoreServer = async () => {
    if (
      (counts?.quizzes ?? 0) > 0 &&
      !confirm(
        "Đã có dữ liệu trong máy. Phục hồi từ bản sao lưu máy chủ sẽ gộp/cập nhật dữ liệu theo mã ID gốc. Tiếp tục?"
      )
    ) {
      return;
    }
    setRestoring(true);
    setMsg(null);
    try {
      const res = await fetch(BACKUP_URL);
      if (!res.ok) {
        throw new Error(`Không tìm thấy file sao lưu trên server (mã lỗi ${res.status}).`);
      }
      const json = await res.json();
      const { restored } = await restoreFromBackup(json);
      setMsg({
        type: "success",
        text: `Phục hồi thành công: ${restored.quizzes ?? 0} bài thi, ${restored.keys ?? 0} mã đề, ${restored.scores ?? 0} bài chấm, ${restored.blobs ?? 0} ảnh phiếu.`,
      });
    } catch (e: unknown) {
      const errText = e instanceof Error ? e.message : "Lỗi khi phục hồi dữ liệu.";
      setMsg({ type: "error", text: errText });
    } finally {
      setRestoring(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    setMsg(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const { restored } = await restoreFromBackup(json);
      setMsg({
        type: "success",
        text: `Đã nhập thành công từ file: ${restored.quizzes ?? 0} bài thi, ${restored.keys ?? 0} mã đề, ${restored.scores ?? 0} bài chấm.`,
      });
    } catch (e: unknown) {
      const errText = e instanceof Error ? e.message : "File sao lưu không hợp lệ.";
      setMsg({ type: "error", text: errText });
    } finally {
      setRestoring(false);
      e.target.value = "";
    }
  };

  const handleExport = async () => {
    try {
      const backup = await exportBackup();
      const str = JSON.stringify(backup, null, 2);
      const blob = new Blob([str], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `du-lieu-fengcheck-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const errText = e instanceof Error ? e.message : "Lỗi khi xuất dữ liệu.";
      alert(errText);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-bold">Cài đặt</h1>
      <p className="mb-4 text-sm text-slate-500">Lưu ngay trên máy này (localStorage).</p>

      <div className="card mb-4 space-y-4 p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Âm thanh</span>
            <span className="text-sm text-slate-500">Tiếng tick khi khóa góc, chuông khi chấm xong</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={settings.sound}
            onChange={(e) => update({ sound: e.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Tự động chụp</span>
            <span className="text-sm text-slate-500">Tự xử lý khi đủ 4 góc marker và ảnh đủ nét</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={settings.autoScan}
            onChange={(e) => update({ autoScan: e.target.checked })}
          />
        </label>

        <div>
          <label className="label">Cooldown sau mỗi lần chấm: {(settings.cooldownMs / 1000).toFixed(1)}s</label>
          <input
            type="range"
            min={1000}
            max={8000}
            step={500}
            value={settings.cooldownMs}
            onChange={(e) => update({ cooldownMs: Number(e.target.value) })}
            className="w-full accent-brand-600"
          />
          <p className="text-xs text-slate-400">
            Chống quét trùng cùng một phiếu (ứng dụng gốc dùng c×1000 ms).
          </p>
        </div>

        <div>
          <label className="label">Điểm tối đa (thang điểm): {settings.maxScore}</label>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={settings.maxScore}
            onChange={(e) => update({ maxScore: Number(e.target.value) })}
            className="w-full accent-brand-600"
          />
          <p className="text-xs text-slate-400">
            Điểm = đúng/tổng × thang, làm tròn 2 chữ số — giống cs.r của ứng dụng gốc.
          </p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-2 font-medium">Dữ liệu trên máy (IndexedDB)</h2>
        <ul className="mb-4 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-4">
          <li className="rounded bg-slate-50 p-2 text-center">
            <span className="block text-lg font-bold text-slate-800">{counts?.quizzes ?? "…"}</span>
            <span className="text-xs text-slate-500">Bài thi</span>
          </li>
          <li className="rounded bg-slate-50 p-2 text-center">
            <span className="block text-lg font-bold text-slate-800">{counts?.keys ?? "…"}</span>
            <span className="text-xs text-slate-500">Mã đề đáp án</span>
          </li>
          <li className="rounded bg-slate-50 p-2 text-center">
            <span className="block text-lg font-bold text-slate-800">{counts?.scores ?? "…"}</span>
            <span className="text-xs text-slate-500">Bài chấm</span>
          </li>
          <li className="rounded bg-slate-50 p-2 text-center">
            <span className="block text-lg font-bold text-slate-800">{counts?.blobs ?? "…"}</span>
            <span className="text-xs text-slate-500">Ảnh phiếu</span>
          </li>
        </ul>

        {msg && (
          <div
            className={`mb-4 rounded-lg p-3 text-sm ${
              msg.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary text-sm"
              disabled={restoring}
              onClick={() => void handleRestoreServer()}
            >
              {restoring ? "Đang phục hồi..." : "🔄 Phục hồi dữ liệu mẫu từ server"}
            </button>

            <label className="btn-secondary cursor-pointer text-sm">
              <span>📥 Nhập từ file JSON</span>
              <input
                type="file"
                accept=".json"
                className="hidden"
                disabled={restoring}
                onChange={(e) => void handleImportFile(e)}
              />
            </label>

            <button
              className="btn-secondary text-sm"
              onClick={() => void handleExport()}
            >
              📤 Xuất file sao lưu (JSON)
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Bản sao lưu server kèm 2 bài thi, 13 mã đề chuẩn, 98 bài chấm và 9 ảnh phiếu mẫu.
          </p>

          <hr className="my-3 border-slate-100" />

          <div>
            <button
              className="btn-danger text-xs"
              onClick={() => {
                if (!confirm("Xóa TOÀN BỘ dữ liệu (bài thi, đáp án, kết quả, ảnh)?")) return;
                void Promise.all([
                  db.quizzes.clear(),
                  db.keys.clear(),
                  db.scores.clear(),
                  db.blobs.clear(),
                ]).then(() => {
                  setMsg({ type: "success", text: "Đã xóa toàn bộ dữ liệu trong IndexedDB." });
                });
              }}
            >
              Xóa toàn bộ dữ liệu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
