"use client";

/**
 * Đồng bộ dữ liệu kèm bản deploy vào máy người dùng.
 *
 * Hai tình huống:
 *  1. IndexedDB TRỐNG (máy mới / origin mới) → nạp toàn bộ dữ liệu kèm bản deploy.
 *  2. Đã có dữ liệu nhưng bản deploy mới hơn lần đồng bộ trước (exportedAt đổi)
 *     → GỘP thêm dữ liệu mới theo id, KHÔNG xoá gì người dùng đã có.
 *
 * Nhờ (2), bản deploy mới có hiệu lực ngay cả khi trình duyệt đã có dữ liệu cũ
 * — trước đây chỉ chạy khi DB trống nên bản mới "không thấy đâu".
 *
 * Mỗi phiên tab chỉ kiểm tra một lần (sessionStorage). Lỗi đều nuốt để app vẫn
 * chạy bình thường nếu bản deploy không kèm dữ liệu.
 */

import { useEffect, useState } from "react";
import {
  BACKUP_URL,
  RESTORE_FLAG,
  RESTORE_VERSION_KEY,
  dbIsEmpty,
  restoreFromBackup,
} from "@/lib/restore";

export default function DataRestore() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_FLAG)) return;
    sessionStorage.setItem(RESTORE_FLAG, "1");

    void (async () => {
      try {
        const empty = await dbIsEmpty();
        const res = await fetch(BACKUP_URL);
        if (!res.ok) return;
        const json = await res.json();

        // Bản deploy này đã đồng bộ rồi → không làm gì.
        const applied = localStorage.getItem(RESTORE_VERSION_KEY);
        const stamp = String(json.exportedAt ?? "");
        if (!empty && stamp && applied === stamp) return;

        const { restored } = await restoreFromBackup(json, (p) => {
          if (p.blobsTotal > 0) {
            setMsg(`Đang nạp dữ liệu: ${p.blobsDone}/${p.blobsTotal} ảnh phiếu…`);
          }
        });
        if (stamp) localStorage.setItem(RESTORE_VERSION_KEY, stamp);
        console.info("[restore] Đã đồng bộ dữ liệu từ bản deploy:", restored, { empty });

        const q = restored.quizzes ?? 0;
        const s = restored.scores ?? 0;
        if (q > 0 || s > 0) {
          const img = restored.blobs ?? 0;
          setMsg(
            `${empty ? "Đã nạp" : "Đã cập nhật"} dữ liệu: ${q} bài thi, ${s} bài chấm${
              img ? `, ${img} ảnh phiếu` : ""
            }.`,
          );
          setTimeout(() => setMsg(null), 8000);
        }
      } catch (err) {
        console.warn("[restore] Bỏ qua đồng bộ dữ liệu:", err);
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
