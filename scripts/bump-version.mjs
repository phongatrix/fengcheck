/**
 * TỰ ĐỘNG TĂNG PHIÊN BẢN sau mỗi lần build.
 *
 * Chạy qua script "postbuild" trong package.json: build N hiển thị phiên bản
 * V_N, sau build package.json giữ V_(N+1) cho lần build kế tiếp — nhờ vậy mỗi
 * lần chỉnh sửa code (đều kèm build) phiên bản tự tăng 1 đơn vị cuối.
 *
 * Chỉ tăng SỐ CUỐI (mã sửa nhỏ): 1.0.0.2 → 1.0.0.3 → … Khi người dùng chủ
 * động nâng số lớn hơn (vd 1.0.1.0) thì lần tăng kế tiếp tiếp tục từ số cuối
 * đó (1.0.1.1).
 */
import { readFileSync, writeFileSync } from "node:fs";

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const raw = String(pkg.version ?? "1.0.0");
const parts = raw.split(".").map((v) => parseInt(v, 10) || 0);
while (parts.length < 4) parts.push(0);
parts[3] += 1;
pkg.version = parts.slice(0, 4).join(".");
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[bump-version] ${raw} → ${pkg.version}`);
