/**
 * Copy bản backup dữ liệu MỚI NHẤT sang `public/backup/du-lieu-fengcheck.json`
 * để app tự phục hồi dữ liệu khi mở lần đầu trên origin mới (deploy Vercel).
 *
 * Chạy trong hook `prebuild`. Thiếu backup thì bỏ qua IM LẶNG — không làm hỏng
 * build trên môi trường không có dữ liệu (vd build trên Vercel từ git).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "backup");

if (!existsSync(dir)) process.exit(0);

// Chọn file mới nhất theo thời gian sửa (không dùng tên ngày — có thể xuất lại cùng ngày).
const files = readdirSync(dir)
  .filter((f) => /^du-lieu-fengcheck-.*\.json$/.test(f))
  .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => a.m - b.m);

if (!files.length) {
  console.log("[sync-backup] Không có file backup — bỏ qua");
  process.exit(0);
}

const src = join(dir, files.at(-1).f);
const dest = join(root, "public", "backup");
mkdirSync(dest, { recursive: true });
copyFileSync(src, join(dest, "du-lieu-fengcheck.json"));
console.log(`[sync-backup] ${files.at(-1).f} → public/backup/du-lieu-fengcheck.json`);
