# NHIỆM VỤ: Deploy project fengcheck lên Vercel

> Ghi cho agent Antigravity. Bản code đã chép xong (toàn thư mục, sạch) từ máy
> chính (`/home/dell/Desktop/chambaiV4/webcam`) ngày 2026-11-18 — chỉ cần
> deploy, KHÔNG sửa code.

## Trạng thái hiện tại

- **Phiên bản:** `package.json` = **1.0.0.57** (postbuild tự tăng sau mỗi `npm run build`)
- **Ứng dụng:** Feng Check — chấm bài trắc nghiệm OMR (Next.js 15, thuần client,
  dữ liệu lưu IndexedDB của người dùng, **không cần biến môi trường server**)
- **Tự phục hồi dữ liệu (v1.0.0.57):** component `DataRestore` — khi mở trên
  origin MỚI với IndexedDB TRỐNG, tự fetch `/backup/du-lieu-fengcheck.json`
  (17MB, kèm 9 ảnh phiếu) và nạp lại 2 bài thi + 13 mã đề + 98 kết quả + 4 mẫu
  phiếu. DB đã có dữ liệu thì KHÔNG đụng vào. Hook `prebuild`
  (`scripts/sync-backup-restore.mjs`) copy backup mới nhất vào `public/backup/`.
- `.gitignore` loại `backup/`, `public/backup/`, `.env.local`, `.vercel/` —
  **tuyệt đối không commit/push dữ liệu học sinh lên GitHub.** `.vercelignore`
  (chỉ chú thích) hiện diện để Vercel CLI KHÔNG áp `.gitignore` khi upload —
  nhờ vậy **Cách A vẫn kèm file backup, Cách B không** (đọc bên dưới).
- Vercel project đã link sẵn trong `.vercel/project.json`:
  - project: **fengcheck** (`prj_m3UNN6Es2qgTIgM09PMdxqN7BRnU`)
  - org: `team_NNimSG8eD49BPgY2WDM0ndYw`
- **Git:** thư mục này hiện CHƯA có repo (đã xoá sạch theo yêu cầu). Muốn deploy
  theo Cách B phải `git init` + nối lại remote
  `https://github.com/phongatrix/fengcheck.git`. Lịch sử git cũ được giữ tại
  `/run/media/dell/Data/zCode/fengcheck-cu-20261118/.git`.

## Cách deploy (chọn 1 trong 2)

### Cách A — qua Vercel CLI (KHUYÊN DÙNG: có kèm dữ liệu backup)

```bash
cd /run/media/dell/Data/zCode/fengcheck
npm install          # nếu chưa có node_modules
npx vercel login     # bỏ qua nếu đã đăng nhập
npx vercel --prod    # deploy thẳng production (đã có .vercel/project.json)
```

### Cách B — qua GitHub (Vercel tự build nếu project đã kết nối repo)

```bash
cd /run/media/dell/Data/zCode/fengcheck
git init && git add -A && git commit -m "fengcheck v1.0.0.57"
git remote add origin https://github.com/phongatrix/fengcheck.git
git push -f origin main
```

⚠️ Cách B sẽ KHÔNG có file backup trên bản deploy (file bị .gitignore để khỏi
đưa dữ liệu học sinh lên GitHub) → app chạy bình thường nhưng bỏ qua bước tự
phục hồi (fetch 404 → im lặng). Muốn có dữ liệu trên vercel.app thì dùng Cách A.

## Kiểm tra sau deploy

1. Mở URL production bằng trình duyệt/cấu hình MỚI (IndexedDB còn trống) →
   chờ vài giây → vào "Kết quả" thấy 98 bài, "Đáp án" thấy 2 bài thi với
   13 mã đề. (Console log: `[restore] Đã phục hồi dữ liệu từ bản sao lưu:`)
2. Nếu DB đã có dữ liệu thì app không tự nạp gì (an toàn — không đè dữ liệu).
3. Trang **Mẫu phiếu** hiện "Giấy khối 12 - TN THPT" (hoặc "QM 2025 — A4
   (Kiểm tra)" nếu DB trống mà thiếu backup) và "Giấy khối 10 - 11".
4. Form **Tạo bài thi**: nút submit là "Lưu bài thi"; ô "Loại phiếu" chỉ còn
   "Giấy khối 10 - 11" / "Giấy khối 12".
5. Nhắc người dùng **reload trang 1 lần** sau deploy (service worker giữ bản cũ).
6. File backup công khai tại `/backup/du-lieu-fengcheck.json` — URL vercel.app
   là công khai, ai có link cũng tải được dữ liệu → cân nhắc trước khi chia sẻ.
