# NHIỆM VỤ: Deploy project fengcheck lên Vercel

> Ghi cho agent Antigravity. Bản code đã đồng bộ từ máy chính ngày 2026-11-18 —
> chỉ cần deploy, KHÔNG sửa code.

## Trạng thái hiện tại

- **Phiên bản:** `package.json` = **1.0.0.58** (postbuild tự tăng sau mỗi `npm run build`)
- **Ứng dụng:** Feng Check — chấm bài trắc nghiệm OMR (Next.js 15, thuần client,
  dữ liệu lưu IndexedDB của người dùng, **không cần biến môi trường server**)
- **Dữ liệu kèm bản deploy (QUAN TRỌNG):**
  `public/backup/du-lieu-fengcheck.json` — **17MB, đã commit vào git** (1 file duy
  nhất) chứa 2 bài thi, 13 mã đề, 98 kết quả, 4 mẫu phiếu, 9 ảnh phiếu.
  - Khi mở app trên origin MỚI với IndexedDB trống → tự nạp (component
    `DataRestore`), hiện toast xanh "Đã tự động nạp dữ liệu mẫu".
  - Trang **Cài đặt → Dữ liệu trên máy (IndexedDB)** có nút
    "🔄 Phục hồi dữ liệu mẫu từ server", "📤 Xuất file sao lưu (JSON)",
    "Xóa toàn bộ dữ liệu".
  - Thư mục gốc `backup/` (bản xuất thủ công) vẫn bị `.gitignore` — chỉ file
    trong `public/backup/` được đẩy lên.
- Vercel project đã link sẵn trong `.vercel/project.json`:
  - project: **fengcheck** (`prj_m3UNN6Es2qgTIgM09PMdxqN7BRnU`)
  - org: `team_NNimSG8eD49BPgY2WDM0ndYw`
- Git: nhánh `main`, remote `origin = https://github.com/phongatrix/fengcheck.git`

## Cách deploy

```bash
cd /run/media/dell/Data/zCode/fengcheck
npx vercel login      # bỏ qua nếu đã đăng nhập
npx vercel --prod     # deploy production (đã có .vercel/project.json)
```

Nếu Vercel project đã kết nối GitHub thì chỉ cần push lên `main` là Vercel tự
build (file dữ liệu đã nằm trong repo nên bản build nào cũng có dữ liệu).

## Kiểm tra sau deploy

1. Mở URL production bằng trình duyệt/cấu hình MỚI (IndexedDB trống) → chờ
   vài giây → toast xanh "Đã tự động nạp dữ liệu mẫu: 2 bài thi, 98 bài chấm";
   vào "Kết quả" thấy 98 bài, "Đáp án" thấy 2 bài thi / 13 mã đề.
2. DB đã có dữ liệu thì app không tự nạp (an toàn — không đè dữ liệu).
3. Trang **Mẫu phiếu** hiện "Giấy khối 12 - TN THPT" (hoặc "QM 2025 — A4
   (Kiểm tra)") và "Giấy khối 10 - 11".
4. Form **Tạo bài thi**: nút submit "Lưu bài thi"; ô "Loại phiếu" chỉ còn
   "Giấy khối 10 - 11" / "Giấy khối 12".
5. Nhắc người dùng **reload trang 1 lần** sau deploy (service worker giữ bản cũ).
6. ⚠️ `public/backup/du-lieu-fengcheck.json` nằm trong repo **công khai** và
   trên URL vercel.app — ai có link đều tải được 98 kết quả chấm + ảnh phiếu.
   Cân nhắc chuyển repo sang private hoặc bỏ file nếu không muốn công khai.
