/**
 * Phục hồi dữ liệu từ file sao lưu (JSON xuất ra bởi quy trình backup) —
 * dùng khi app mở LẦN ĐẦU trên một origin mới (vd sau khi deploy Vercel):
 * IndexedDB trống → nạp lại toàn bộ bài thi / đáp án / kết quả / mẫu phiếu / ảnh.
 *
 * Nguyên tắc an toàn:
 *  - CHỈ phục hồi khi DB còn trống — không bao giờ đè dữ liệu hiện có;
 *  - ghi bằng `bulkPut` giữ nguyên id gốc nên chạy lại cũng idempotent;
 *  - mọi lỗi đều nuốt (bản deploy không có file backup → bỏ qua im lặng).
 */

import { db } from "@/lib/db";

/** Vị trí file backup trong `public/` (prebuild tự copy từ thư mục `backup/`). */
export const BACKUP_URL = "/backup/du-lieu-fengcheck.json";

/** Cờ sessionStorage: mỗi phiên chỉ kiểm tra phục hồi một lần. */
export const RESTORE_FLAG = "fengcheck-restore-checked";

export interface BackupFile {
  app?: string;
  dbName?: string;
  dbVersion?: number;
  exportedAt?: string;
  data: Record<string, unknown[]>;
}

/** true khi toàn bộ các bảng nghiệp vụ còn trống (app chưa được dùng). */
export async function dbIsEmpty(): Promise<boolean> {
  const [q, k, s, t] = await Promise.all([
    db.quizzes.count(),
    db.keys.count(),
    db.scores.count(),
    db.templates.count(),
  ]);
  return q + k + s + t === 0;
}

/** Giải mã base64 → mảng byte (ảnh phiếu trong bảng blobs). */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8 as Uint8Array<ArrayBuffer>;
}

export interface RestoreResult {
  /** Số bản ghi đã nạp theo từng bảng. */
  restored: Record<string, number>;
}

/** Nạp các bảng từ object backup vào DB (caller phải đã kiểm tra DB trống). */
export async function restoreFromBackup(json: BackupFile): Promise<RestoreResult> {
  const d = json.data ?? {};
  const restored: Record<string, number> = {};

  if (d.blobs?.length) {
    const rows = d.blobs.map((r) => ({
      ...(r as { data: string; [k: string]: unknown }),
      data: b64ToBytes((r as { data: string }).data),
    }));
    await db.blobs.bulkPut(rows as never[]);
    restored.blobs = rows.length;
  } else {
    // Backup cũ không có ảnh → bỏ imageId để kết quả không trỏ tới blob thiếu.
    for (const s of d.scores ?? []) delete (s as { imageId?: string }).imageId;
  }

  for (const [table, rows] of Object.entries(d)) {
    if (table === "blobs" || !rows?.length) continue;
    await db.table(table).bulkPut(rows as never[]);
    restored[table] = rows.length;
  }
  return { restored };
}
