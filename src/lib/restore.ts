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

/** true khi các bảng dữ liệu chính (bài thi, kết quả chấm) còn trống. */
export async function dbIsEmpty(): Promise<boolean> {
  const [q, s] = await Promise.all([
    db.quizzes.count(),
    db.scores.count(),
  ]);
  return q === 0 && s === 0;
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

/** Chuyển Uint8Array thành chuỗi base64 (chia chunk tránh tràn stack). */
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, len));
    for (let j = 0; j < sub.length; j++) {
      bin += String.fromCharCode(sub[j]);
    }
  }
  return btoa(bin);
}

/** Xuất toàn bộ dữ liệu trong IndexedDB thành object BackupFile để tải về. */
export async function exportBackup(): Promise<BackupFile> {
  const [quizzes, keys, scores, templates, blobsRaw] = await Promise.all([
    db.quizzes.toArray(),
    db.keys.toArray(),
    db.scores.toArray(),
    db.templates.toArray(),
    db.blobs.toArray(),
  ]);

  const blobs = blobsRaw.map((b) => ({
    id: b.id,
    name: b.name,
    mime: b.mime,
    data: bytesToB64(b.data),
  }));

  return {
    app: "Feng Check",
    dbName: "chambai-webcam",
    dbVersion: 110,
    exportedAt: new Date().toISOString(),
    data: {
      quizzes,
      keys,
      scores,
      templates,
      blobs,
    },
  };
}

