"use client";

/**
 * Tự phục hồi dữ liệu khi app mở trên origin MỚI (vd sau khi deploy Vercel):
 * DB trống + có file backup trong `/backup` → nạp lại toàn bộ bài thi, đáp án,
 * kết quả, ảnh phiếu. DB đã có dữ liệu → KHÔNG đụng vào.
 *
 * Mỗi phiên tab chỉ kiểm tra một lần (sessionStorage) để không fetch file
 * backup ~17MB mỗi lần mở trang. Lỗi đều nuốt — app vẫn chạy nếu thiếu backup.
 */

import { useEffect } from "react";
import { BACKUP_URL, dbIsEmpty, RESTORE_FLAG, restoreFromBackup } from "@/lib/restore";

export default function DataRestore() {
  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_FLAG)) return;
    sessionStorage.setItem(RESTORE_FLAG, "1");
    void (async () => {
      try {
        if (!(await dbIsEmpty())) return; // DB có dữ liệu → bỏ qua
        const res = await fetch(BACKUP_URL);
        if (!res.ok) return; // bản deploy không có file backup
        const json = await res.json();
        const { restored } = await restoreFromBackup(json);
        console.info("[restore] Đã phục hồi dữ liệu từ bản sao lưu:", restored);
      } catch (err) {
        console.warn("[restore] Bỏ qua phục hồi dữ liệu:", err);
      }
    })();
  }, []);
  return null;
}
