"use client";

/**
 * Tự phục hồi dữ liệu khi app mở trên origin MỚI (vd sau khi deploy Vercel):
 * DB trống + có file backup trong `/backup` → nạp lại toàn bộ bài thi, đáp án,
 * kết quả, ảnh phiếu. DB đã có dữ liệu → KHÔNG đụng vào.
 *
 * Mỗi phiên tab chỉ kiểm tra một lần (sessionStorage) để không fetch file
 * backup ~17MB mỗi lần mở trang. Lỗi đều nuốt — app vẫn chạy nếu thiếu backup.
 */

import { useEffect, useState } from "react";
import { BACKUP_URL, dbIsEmpty, RESTORE_FLAG, restoreFromBackup } from "@/lib/restore";

export default function DataRestore() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_FLAG)) return;

    void (async () => {
      try {
        const empty = await dbIsEmpty();
        if (!empty) {
          sessionStorage.setItem(RESTORE_FLAG, "1");
          return;
        }

        const res = await fetch(BACKUP_URL);
        if (!res.ok) return;

        const json = await res.json();
        const { restored } = await restoreFromBackup(json);
        sessionStorage.setItem(RESTORE_FLAG, "1");
        console.info("[restore] Đã phục hồi dữ liệu từ bản sao lưu:", restored);

        const q = restored.quizzes ?? 0;
        const s = restored.scores ?? 0;
        if (q > 0 || s > 0) {
          setMsg(`Đã tự động nạp dữ liệu mẫu: ${q} bài thi, ${s} bài chấm.`);
          setTimeout(() => setMsg(null), 6000);
        }
      } catch (err) {
        console.warn("[restore] Bỏ qua phục hồi dữ liệu:", err);
      }
    })();
  }, []);

  if (!msg) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-xl animate-in fade-in slide-in-from-bottom-2">
      <span className="text-base">✓</span>
      <span>{msg}</span>
    </div>
  );
}
