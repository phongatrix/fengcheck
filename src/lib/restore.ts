/**
 * Phục hồi dữ liệu từ bản backup phục vụ trong `public/backup/` — dùng khi app
 * mở LẦN ĐẦU trên một origin mới (vd sau khi deploy Vercel): IndexedDB trống →
 * nạp lại bài thi / mã đề / kết quả / mẫu phiếu / ảnh phiếu.
 *
 * Định dạng asset (do `scripts/sync-backup-restore.mjs` sinh ra):
 *   /backup/du-lieu-fengcheck.json  — dữ liệu bảng + danh sách `blobFiles`
 *   /backup/blobs/<id>.<ext>        — ảnh nhị phân, tải LẦN LƯỢT
 *
 * Nguyên tắc an toàn:
 *  - CHỈ phục hồi khi DB còn trống (không đè dữ liệu đang dùng);
 *  - ghi bằng `bulkPut` giữ nguyên id gốc nên chạy lại cũng idempotent;
 *  - ảnh tải lỗi thì bỏ qua ảnh đó, không chặn cả quá trình;
 *  - mọi lỗi mạng đều nuốt (bản deploy không có backup → im lặng).
 */

import { db } from "@/lib/db";

/** Gốc thư mục asset phục hồi trong `public/`. */
export const BACKUP_DIR = "/backup";
export const BACKUP_URL = `${BACKUP_DIR}/du-lieu-fengcheck.json`;

/** Cờ sessionStorage: mỗi phiên chỉ kiểm tra phục hồi một lần. */
export const RESTORE_FLAG = "fengcheck-restore-checked";

/**
 * localStorage giữ `exportedAt` của bản backup đã áp dụng. Khi deploy bản mới
 * (exportedAt đổi) app đồng bộ thêm một lần — nhờ vậy bản deploy mới có hiệu
 * lực ngay cả khi máy người dùng đã có dữ liệu cũ, mà vẫn không đụng dữ liệu
 * người dùng tự tạo (gộp theo id, `bulkPut`).
 */
export const RESTORE_VERSION_KEY = "fengcheck-restore-version";

/** Một ảnh phiếu nằm rời trong `public/backup/blobs/`. */
export interface BlobFileRef {
  id: string;
  name: string;
  mime: string;
  createdAt?: number;
  file: string;
}

export interface BackupFile {
  app?: string;
  dbName?: string;
  dbVersion?: number;
  exportedAt?: string;
  source?: string;
  data: Record<string, unknown[]>;
  /** Có ở định dạng mới (ảnh tách rời). Thiếu = backup cũ nhúng base64. */
  blobFiles?: BlobFileRef[];
}

/** true khi các bảng dữ liệu chính (bài thi, kết quả chấm) còn trống. */
export async function dbIsEmpty(): Promise<boolean> {
  const [q, s] = await Promise.all([db.quizzes.count(), db.scores.count()]);
  return q === 0 && s === 0;
}

/** Giải mã base64 → mảng byte (backup cũ nhúng ảnh dạng base64). */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8 as Uint8Array<ArrayBuffer>;
}

export interface RestoreProgress {
  /** Số ảnh đã nạp / tổng số ảnh cần nạp. */
  blobsDone: number;
  blobsTotal: number;
}

export interface RestoreResult {
  /** Số bản ghi đã nạp theo từng bảng. */
  restored: Record<string, number>;
}

/**
 * Nạp các bảng rồi tới ảnh. `onProgress` cho UI hiện tiến trình (ảnh tải lâu).
 */
export async function restoreFromBackup(
  json: BackupFile,
  onProgress?: (p: RestoreProgress) => void,
): Promise<RestoreResult> {
  const d = json.data ?? {};
  const restored: Record<string, number> = {};

  // 1) Bảng dữ liệu (trừ ảnh) — nạp trước để UI có nội dung ngay.
  for (const [table, rows] of Object.entries(d)) {
    if (table === "blobs" || !rows?.length) continue;
    await db.table(table).bulkPut(rows as never[]);
    restored[table] = rows.length;
  }

  // 2) Ảnh: định dạng mới (file rời) hoặc cũ (base64 nhúng).
  const refs = json.blobFiles ?? [];
  const embedded = (d.blobs ?? []) as { id: string; data: string }[];
  const total = refs.length + embedded.length;
  let done = 0;

  for (const b of embedded) {
    try {
      await db.blobs.put({ ...b, data: b64ToBytes(b.data) } as never);
      done++;
    } catch {
      /* bỏ qua ảnh lỗi */
    }
  }
  onProgress?.({ blobsDone: done, blobsTotal: total });

  for (const r of refs) {
    try {
      const res = await fetch(`${BACKUP_DIR}/${r.file}`);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        await db.blobs.put({ id: r.id, name: r.name, mime: r.mime, createdAt: r.createdAt ?? Date.now(), data: bytes } as never);
      }
    } catch {
      /* bỏ qua ảnh lỗi */
    }
    done++;
    onProgress?.({ blobsDone: done, blobsTotal: total });
  }
  if (done) restored.blobs = done;

  // 3) Ảnh không nạp được → bỏ imageId để trang Kết quả không trỏ tới blob thiếu.
  if (total === 0) {
    for (const s of d.scores ?? []) delete (s as { imageId?: string }).imageId;
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
    for (let j = 0; j < sub.length; j++) bin += String.fromCharCode(sub[j]);
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

  const blobs = blobsRaw.map((b) => ({ id: b.id!, name: b.name, mime: b.mime, createdAt: b.createdAt, data: bytesToB64(b.data) }));

  return {
    app: "Feng Check",
    dbName: "chambai-webcam",
    dbVersion: 110,
    exportedAt: new Date().toISOString(),
    data: { quizzes, keys, scores, templates, blobs },
  };
}
