/**
 * Chuyển bản backup dữ liệu (`backup/du-lieu-fengcheck-*.json`, ảnh lưu base64)
 * thành bộ asset phục vụ trang web:
 *
 *   public/backup/du-lieu-fengcheck.json   — bài thi / mã đề / kết quả / mẫu phiếu
 *   public/backup/blobs/<id>.png           — ảnh phiếu dạng NHỊ PHÂN (không base64)
 *
 * Lý do tách: ảnh base64 làm file phình ~33% và vượt giới hạn tải một lần của
 * trình duyệt (bộ dữ liệu thật ~135MB ảnh → 181MB JSON). Tách nhị phân giúp app
 * phục hồi từng ảnh và hiển thị tiến trình.
 *
 * Chạy trong hook `prebuild`. Không có backup → bỏ qua im lặng.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const backupDir = join(root, "backup");
const outDir = join(root, "public", "backup");
const blobsDir = join(outDir, "blobs");

if (!existsSync(backupDir)) process.exit(0);

const files = readdirSync(backupDir)
  .filter((f) => /^du-lieu-fengcheck-.*\.json$/.test(f))
  .map((f) => ({ f, m: statSync(join(backupDir, f)).mtimeMs }))
  .sort((a, b) => a.m - b.m);

if (!files.length) {
  console.log("[build-backup] Không có file backup — bỏ qua");
  process.exit(0);
}

const srcName = files.at(-1).f;
const src = JSON.parse(readFileSync(join(backupDir, srcName), "utf8"));
const data = src.data ?? {};

// Dựng lại bộ ảnh nhị phân (xoá bản cũ để không sót ảnh đã bị xoá trong DB).
rmSync(blobsDir, { recursive: true, force: true });
mkdirSync(blobsDir, { recursive: true });

const blobFiles = [];
for (const b of data.blobs ?? []) {
  const mime = String(b.mime || "image/png");
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const rel = `blobs/${b.id}.${ext}`;
  writeFileSync(join(outDir, rel), Buffer.from(String(b.data), "base64"));
  blobFiles.push({ id: b.id, name: b.name, mime, createdAt: b.createdAt, file: rel });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "du-lieu-fengcheck.json"),
  JSON.stringify({
    app: src.app ?? "Feng Check",
    dbName: src.dbName ?? "chambai-webcam",
    dbVersion: src.dbVersion ?? 110,
    exportedAt: src.exportedAt,
    source: src.source,
    data: {
      quizzes: data.quizzes ?? [],
      keys: data.keys ?? [],
      scores: data.scores ?? [],
      templates: data.templates ?? [],
    },
    blobFiles,
  }),
);

const size = statSync(join(outDir, "du-lieu-fengcheck.json")).size;
console.log(
  `[build-backup] ${srcName} → public/backup (${blobFiles.length} ảnh, json ${(size / 1048576).toFixed(2)}MB)`,
);
