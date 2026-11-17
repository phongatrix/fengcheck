"use client";

/** Cài đặt ứng dụng: âm thanh, tự chụp, cooldown, điểm tối đa, dữ liệu. */

import { useAppSettings } from "@/hooks/use-app-settings";
import { db } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";

export default function SettingsPage() {
  const { settings, update } = useAppSettings();
  const counts = useLiveQuery(
    async () => ({
      quizzes: await db.quizzes.count(),
      keys: await db.keys.count(),
      scores: (await db.scores.toArray()).filter((s) => s.type !== -1).length,
      blobs: await db.blobs.count(),
    }),
    [],
  );

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
        <ul className="mb-3 text-sm text-slate-600">
          <li>Bài thi: {counts?.quizzes ?? "…"}</li>
          <li>Mã đề đáp án: {counts?.keys ?? "…"}</li>
          <li>Bản ghi chấm: {counts?.scores ?? "…"}</li>
          <li>Ảnh phiếu đã lưu: {counts?.blobs ?? "…"}</li>
        </ul>
        <button
          className="btn-danger"
          onClick={() => {
            if (!confirm("Xóa TOÀN BỘ dữ liệu (bài thi, đáp án, kết quả, ảnh)?")) return;
            void Promise.all([
              db.quizzes.clear(),
              db.keys.clear(),
              db.scores.clear(),
              db.blobs.clear(),
            ]).then(() => alert("Đã xóa toàn bộ dữ liệu."));
          }}
        >
          Xóa toàn bộ dữ liệu
        </button>
      </div>
    </div>
  );
}
