"use client";

/**
 * Tự phục hồi dữ liệu khi app mở trên origin MỚI (vd sau khi deploy Vercel):
 * DB trống + có bộ asset trong `/backup` → nạp lại bài thi, mã đề, kết quả,
 * mẫu phiếu và ảnh phiếu (ảnh tải lần lượt, hiện tiến trình).
 * DB đã có dữ liệu → KHÔNG đụng vào.
 *
 * Mỗi phiên tab chỉ kiểm tra một lần (sessionStorage). Lỗi đều nuốt — app vẫn
 * chạy bình thường nếu bản deploy không kèm dữ liệu.
 */

import { useEffect, useState } from "react";
import { BACKUP_URL, dbIsEmpty, RESTORE_FLAG, restoreFromBackup } from "@/lib/restore";

export default function DataRestore() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_FLAG)) return;

    void (async () => {
      try {
        if (!(await dbIsEmpty())) {
          sessionStorage.setItem(RESTORE_FLAG, "1");
          return;
        }

        const res = await fetch(BACKUP_URL);
        if (!res.ok) return;

        const json = await res.json();
        const { restored } = await restoreFromBackup(json, (p) => {
          // Chỉ báo khi có ảnh cần tải (bộ dữ liệu lớn mất vài chục giây).
          if (p.blobsTotal > 0) {
            setMsg(`Đang nạp dữ liệu: ${p.blobsDone}/${p.blobsTotal} ảnh phiếu…`);
          }
        });
        sessionStorage.setItem(RESTORE_FLAG, "1");
        console.info("[restore] Đã phục hồi dữ liệu từ bản sao lưu:", restored);

        const q = restored.quizzes ?? 0;
        const s = restored.scores ?? 0;
        if (q > 0 || s > 0) {
          const img = restored.blobs ?? 0;
          setMsg(`Đã nạp dữ liệu: ${q} bài thi, ${s} bài chấm${img ? `, ${img} ảnh phiếu` : ""}.`);
          setTimeout(() => setMsg(null), 8000);
        }
      } catch (err) {
        console.warn("[restore] Bỏ qua phục hồi dữ liệu:", err);
        setMsg(null);
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
