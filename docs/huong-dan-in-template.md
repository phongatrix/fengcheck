# Hướng dẫn in mẫu phiếu & quy trình chấm bài bằng webcam

## 1. In phiếu

### Dùng file PDF gốc (khuyên dùng)

Hai mẫu được hỗ trợ chính xác là:

- **Giấy 12** — `Giay12.pdf`: PHẦN I 40 câu (A–D), PHẦN II 8 câu
  (a–d, Đúng/Sai), PHẦN III 6 câu số, mã đề 4 cột (tô 3 số bên phải),
  SBD 8 cột.
- **Giấy 10-11** — `Giay10_11.pdf`: PHẦN I 30 câu (A–D, 3 khối 10),
  PHẦN II 10 câu, PHẦN III 10 câu số, mã đề 3 cột.
- **Mới 2025** — ảnh `moi.png` (chambaiV3): PHẦN I 20 câu, PHẦN II 4 câu,
  PHẦN III 8 câu số, mã đề 3 cột, SBD viết tay. Ảnh gốc là bản dựng từ
  ảnh chụp nên nét kém hơn PDF — độ đọc đạt khoảng 78%.

In **đen trắng**, khổ giấy đúng với file, chọn **Actual size / 100%**
(không dùng “Fit to page”). Marker 4 góc và các ô tròn phải nét, không
bị mờ hay tạt mực.

### Phiếu tự thiết kế

Trang **Mẫu phiếu** sinh SVG khớp 1:1 với bộ detect — chọn loại giấy, số câu,
bấm *In phiếu*.

## 2. Chuẩn bị đáp án chuẩn

1. **Đáp án** → **Tạo bài thi** → chọn mẫu giấy, đặt thang điểm `P1,P2,P3`
   (VD `6,4,0` = P1 tối đa 6đ, P2 tối đa 4đ chia theo nhóm 2 câu, P3 0đ).
2. **Thêm mã đề** → nhập 3 số (VD `314`):
   - *Dán nhanh*: gõ chuỗi đáp án theo thứ tự câu rồi Enter —
     PHẦN I dùng `A B C D`, PHẦN II dùng `Đ`/`S`, PHẦN III dùng chữ số
     `0-9`, dùng `-` để bỏ trống một câu.
     VD 96 câu Giấy 12: `ABCABC…` (40) + `ĐSSĐ…` (32) + `0325…` (24).
   - *Nhập nhanh file mẫu*: bấm nút K10/K11/K12 để nhập file đáp án
     Smarttest của chambaiV3 (hàng = câu, cột = mã đề, giá trị A-D /
     `ĐSĐĐ` / số) — đã kèm sẵn trong app tại `/templates/`.
   - Hoặc import CSV/XLSX, dán mã chia sẻ, quét QR từ máy khác.

## 3. Quy trình chụp

1. **Chụp bài** → chọn bài thi (dropdown trên cùng).
2. Đặt phiếu trên nền tương đối tối, phẳng, đủ sáng, tránh bóng đổ đè lên
   4 marker góc.
3. Bấm **Bật camera**, đưa phiếu vào khung định vị sao cho 4 marker góc nằm
   tròn trong 4 ngoặc của khung.
4. Giữ máy song song với mặt giấy. Khi đủ 4 góc + ảnh đủ nét, app **tự chụp**
   (âm tick + viền xanh). Có thể bấm **Chụp ngay** để chủ động.
5. Thẻ kết quả hiện: điểm tổng, từng phần `P1/P2/P3`, mã đề, mã SV/SBD và
   ảnh phiếu đã annotate (xanh = đúng, đỏ = sai).
6. **Lưu** hoặc **Lưu & chấm tiếp** cho phiếu kế tiếp (có cooldown chống quét
   trùng). Phiếu mờ/góc thiếu → **Chụp lại**.

## 4. Tải ảnh lên (không camera)

Mục **Chụp bài** → **Tải ảnh lên**: chọn ảnh JPEG/PNG chụp hoặc scan phiếu —
cùng pipeline như webcam (không kiểm tra độ nét nên ảnh mềm vẫn đọc được).

## 5. Kết quả & xuất file

Trang **Kết quả**: lọc theo bài thi, xem lại ảnh phiếu, tải ảnh PNG, xóa bản
ghi, và **Xuất Excel** (.xlsx) toàn bộ bản ghi đang lọc.

## 6. Sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
| --- | --- |
| “Đang tìm marker…” mãi | 4 marker góc chưa đủ trong khung, hoặc bị bóng đổ/băng dính che |
| “Ảnh mờ” | Giữ máy chắc, đợi lấy nét, tăng sáng |
| Mã đề sai / trống | Kiểm tra ô mã đề đã tô đủ 3 số; phiếu in phải nét |
| Đọc không chắc (-4/-2) | Có câu tô đè 2 ô hoặc tô nhạt — xem ảnh annotated, chụp lại |
| Điểm P2/P3 = 0.00 | Thang điểm phần đó = 0 (VD `6,4,0`) hoặc chưa có đáp án cho mã đề này |
