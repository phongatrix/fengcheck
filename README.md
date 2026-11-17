# Chấm thi — Webcam OMR (Giấy 12 / Giấy 10-11)

Ứng dụng web **chấm phiếu trắc nghiệm bằng webcam**: bật camera, căn phiếu vào
frame định vị, hệ thống tự tìm 4 marker góc → warp perspective → đọc bubble +
mã đề + số báo danh → chấm điểm theo đáp án chuẩn và hiển thị kết quả theo
đúng format của ứng dụng gốc:

```
P1: 40/40=6.00
P2: 4/4; 4/4; 4/4; 4/4 = 4.00
P3: 24/24=0.00
Tong: 10.00
```

Hỗ trợ **2 mẫu giấy thật** (hình học trích xuất trực tiếp từ file PDF vector
của mẫu, nên in từ PDF gốc là khớp 100%):

| Mẫu | PHẦN I | PHẦN II | PHẦN III | Mã đề | SBD |
| --- | --- | --- | --- | --- | --- |
| **Giấy 12** | 40 câu, A–D | 8 câu × a)–d) × Đúng/Sai | 6 câu số × 4 chữ số | 4 cột (tô 3 số phải) | 8 cột × 10 |
| **Giấy 10-11** | 30 câu, A–D | 10 câu × a)–d) × Đúng/Sai | 10 câu số × 4 chữ số | 3 cột | — |

Ngoài ra còn loại phiếu **tự thiết kế (A4/A6/A8)** sinh từ chính bộ tọa độ của
bộ detect (in trực tiếp từ trang “Mẫu phiếu”).

## Chạy

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production
npm test           # 33 test (round-trip 2 mẫu giấy, chấm điểm, marker detect)
npm run typecheck
```

## Quy trình chấm bài

1. **Quản lý đáp án** → tạo bài thi (chọn mẫu Giấy 12 / Giấy 10-11), nhập đáp án:
   - dán nhanh `ADBACCCAAD…ĐS…0123` (Enter) — theo đúng thứ tự câu,
   - import CSV/XLSX, dán mã chia sẻ `123456789…`, quét QR,
   - thang điểm từng phần `P1,P2,P3` (VD `6,4,0`; mặc định 6/4/0),
2. **Chụp bài** → chọn bài thi → bật camera → đưa phiếu vào khung định vị:
   - hệ thống dò 4 marker góc (~4 lần/giây), đủ 4 góc + ảnh nét → tự chụp,
   - warp perspective → đọc bubble/mã đề/SBD → chấm → hiện kết quả + ảnh annotated,
   - **Lưu** / **Lưu & chấm tiếp** / **Chụp lại**; hoặc **Tải ảnh lên** để chấm ảnh có sẵn.
3. **Kết quả** → lịch sử + ảnh phiếu đã chấm, xuất `.xlsx`.

## Kiến trúc

```
src/
  lib/omr/           # engine OMR thuần TypeScript (chạy trong Web Worker)
    types.ts         #  SheetLayout: P1/P2/P3, mã đề, SBD, marker
    giay-layouts.ts  #  hình học 2 mẫu giấy (trích từ PDF vector)
    sheet.ts         #  layout tùy chỉnh + điều phối theo loại phiếu
    markers.ts       #  dò giấy (thành phần sáng lớn nhất) → định vị marker
                     #  theo tỉ lệ trang + snap bubble chống méo ống kính
    matrix.ts        #  grayscale, adaptive threshold, homography warp…
    reader.ts        #  đọc bubble (2 chiến lược + peak rule), mã số, annotate
    render-sheet.ts  #  render phiếu tổng hợp cho test
    pipeline.ts      #  probe (overlay) + process (đọc + chấm + preview)
  workers/omr-worker.ts  # toàn bộ xử lý ảnh chạy off-thread
  hooks/use-omr-scanner.ts  # vòng lặp camera: probe → ổn định → chụp, cooldown
  lib/scoring.ts     # formatScore (round 2 chữ số), gradeGiay (P1/P2/P3/Tong)
  lib/sharecode.ts   # mã chia sẻ đúng format app gốc (123456789…)
  lib/db.ts          # IndexedDB (Dexie): quizzes, keys, scores, ảnh PNG
```

### Độ bền trên ảnh thật

- **Dò giấy trước, marker sau**: vùng sáng lớn nhất = tờ giấy; marker được tìm
  cục bộ quanh tỉ lệ trang của nó (cửa sổ thích ứng), nên chịu được chữ viết,
  dấu đỏ/xanh của app khác đè lên phiếu.
- **Che màu đỏ/xanh** khi dò marker; **snap từng bubble** theo trọng tâm nét
  chống méo ống kính; **peak rule** đọc mã số ngay cả khi viền ô in đậm.
- Ảnh giấy bị cắt góc: tự fallback warp cả tờ theo khổ trang.
- Ảnh nhỏ tự phóng to trước khi xử lý; ink map tự chỉnh ngưỡng theo mật độ
  mực (ảnh scan tối/mờ vẫn đọc được).
- Đã kiểm chứng: scan PDF gốc (nhiễu + nghiêng perspective) → đọc đúng
  96/96 và 110/110 đáp án, mã đề, SBD; scan mẫu Mới 2025 (ảnh reconstruction
  nét kém) đọc ~78% — nên in từ file mẫu gốc sạch khi có.

## Deploy

Tĩnh, không cần backend: `next build` → Vercel/Node. Dữ liệu lưu local
(IndexedDB), không cần đăng nhập. PWA cài được lên điện thoại (camera sau).

## Tài liệu

- [Hướng dẫn in phiếu & quy trình chụp](docs/huong-dan-in-template.md)
- File PDF mẫu: `tulieuchambai/maugiay/Giay12.pdf`, `Giay10_11.pdf`
