# HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY — App chấm thi OMR bằng webcam

## Cách nhanh nhất (khuyến nghị)

Một file lo cho tất cả: kiểm tra Node → cài dependencies → build → chọn cổng →
chạy app → in địa chỉ. Chạy được trên **Linux, macOS và Windows**.

| Hệ điều hành | Lệnh |
| --- | --- |
| **Linux / macOS** | `./run.sh`  *(hoặc `node run.mjs`)* |
| **Windows** | bấm đúp **`start.cmd`**  *(hoặc `node run.mjs`)* |

Lần đầu mất 2–4 phút (cài dependencies + build). Các lần sau chỉ ~5–10 giây vì
script tự phát hiện đã cài/đã build rồi bỏ qua.

### Tuỳ chọn

```bash
node run.mjs                  # cài + build + chạy ở cổng 3210
node run.mjs --port=3211      # chạy cổng khác (đổi cổng = đổi origin = mất dữ liệu cũ)
node run.mjs --port=3210 --force   # cổng đang bận → kill tiến trình cũ rồi chạy
node run.mjs --dev            # chế độ phát triển (hot-reload)
node run.mjs --rebuild        # buộc build lại
node run.mjs --reinstall      # xoá node_modules rồi cài lại từ đầu
node run.mjs --test           # chạy test suite trước khi chạy app
node run.mjs --help           # xem trợ giúp
```

## 1. Yêu cầu máy

- **Node.js ≥ 18.17** (khuyến nghị Node 20 LTS; máy phát triển chạy Node 26)
  - Kiểm tra: `node -v`
  - Cài:
    - Windows: tải tại https://nodejs.org hoặc `winget install OpenJS.NodeJS.LTS`
    - Ubuntu/Debian: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
    - Fedora: `sudo dnf module install nodejs:20`
    - macOS: `brew install node@20`
- Trình duyệt hiện đại (**Chrome/Edge**) — dữ liệu lưu trong **IndexedDB** của
  trình duyệt, không cần cài database
- Webcam (nếu chấm qua camera) hoặc ảnh scan/chụp (nếu chấm bằng upload)

## 2. Cài đặt thủ công (nếu không dùng `run.mjs`)

```bash
cd fengcheck          # thư mục project
npm install           # hoặc: npm ci  (nếu có package-lock.json)
npm run build         # build production + tự tăng phiên bản
npx next start -p 3210
```

Kiểm tra code / test:

```bash
npm run typecheck                  # tsc --noEmit
npx vitest run --maxWorkers=1      # 194 test (phải chạy 1 worker)
```

## 3. Sử dụng nhanh

1. **Tạo bài thi + nhập đáp án**: trang *Quản lý đáp án* → tạo bài thi, chọn
   loại phiếu, import đáp án từ Excel (hàng đầu `Câu\Mã đề`), QR JSON hoặc mã
   chia sẻ. Cấu hình điểm ở *Thiết lập điểm*.
2. **Chấm bài**: trang *Chấm bài* — chụp bằng webcam (căn phiếu vào frame) hoặc
   upload nhiều ảnh scan/chụp cùng lúc.
3. **Xem kết quả**: trang *Kết quả* — nhóm theo đợt chấm, xem ảnh phiếu đã
   khoanh, xuất **XLSX / PDF / ZIP**.

### Lưu ý quan trọng

- **Sau mỗi lần build lại phải reload trang 1 lần** (service worker giữ bản cũ —
  không reload sẽ treo "Đang xử lý...").
- Dữ liệu nằm trong IndexedDB `chambai-webcam` **theo origin**:
  `localhost:3210` ≠ `localhost:3000` ≠ `localhost:3211` → muốn giữ dữ liệu cũ
  thì luôn chạy cùng một cổng.
- Webcam chỉ hoạt động trên `localhost` hoặc HTTPS.
- Scan photocopy **nhạt/mờ**: app đã có cân bằng sáng 2 lượt + so khớp mã đề
  "duy nhất theo tiền tố/hậu tố" — vẫn nên scan ≥ 200dpi, đậm rõ.
- Ảnh upload được thu về 1800px; chấm ~2–3 giây/ảnh.

## 4. Cấu trúc chính

```
run.mjs             ★ script tự động đa nền tảng (Node.js)
run.sh              wrapper Linux/macOS
start.cmd           wrapper Windows (bấm đúp)
src/app/            các trang: scan, keys, results, settings, template
src/lib/omr/        pipeline OMR: markers, warp, reader, form-detect,
                    grid-fit, sheet-crop, preprocess, annotate
src/lib/            points, keys, store (Dexie), export xlsx/pdf, import
src/workers/        web worker chạy pipeline (không khoá UI)
src/components/     UI: qr, points-editor, answer-sheet-overlay
tests/              194 test vitest
docs/               tài liệu mẫu phiếu
public/             sw.js (service worker — bump CACHE sau thay đổi lớn)
scripts/            bump-version.mjs, tiện ích tạo fixture
```

## 5. Phiên bản

`package.json` tự tăng số cuối sau mỗi lần `npm run build` (script postbuild).
Phiên bản hiện tại: xem badge góc trên bên trái của web app.
