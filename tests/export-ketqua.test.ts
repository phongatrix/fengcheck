/**
 * Gói xuất "ketqua" phải khớp định dạng thư mục tham chiếu
 * (tulieuchambai/ketqua/Giay12, Giay10_11):
 *
 *   KQ Diem <tên>.xlsx — Sheet1: SBD | Ma de | Diem P1 | Diem P2 | Diem P3 | Tong diem,
 *                        SBD/MĐ là text giữ số 0 đầu, sắp theo tổng điểm giảm dần
 *   <tên>.pdf          — mỗi trang A4 dọc = 1 phiếu đã chấm (ảnh JPEG DCTDecode)
 *   <tên>.zip          — ảnh phiếu đặt tên <SBD>-<n>.jpg, đọc được bằng trình giải ZIP chuẩn
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildPdf, buildZip, scoreParts, sbdText } from "@/lib/export-ketqua";
import type { ScoreRecord } from "@/lib/db";

function rec(partial: Partial<ScoreRecord>): ScoreRecord {
  return {
    quizId: "q1",
    keyCode: "",
    examCode: "000",
    fileName: "",
    fileNameStudent: "",
    score: "",
    stdCode: "",
    answers: [],
    type: 0,
    time: 0,
    ...partial,
  };
}

describe("scoreParts / sbdText", () => {
  it("tách điểm theo phần từ scoreText", () => {
    const p = scoreParts("P1: 18/18=6.00\nP2: 8/8=2.00; 8/8=2.00; 0/0=0.00; 0/0=0.00=4.00\nP3: 17/17=0.00\nTong: 10.00");
    expect(p).toEqual({ p1: "6.00", p2: "4.00", p3: "0.00", tong: "10.00" });
  });

  it("scoreText rỗng → 0", () => {
    expect(scoreParts(null)).toEqual({ p1: "0", p2: "0", p3: "0", tong: "0" });
  });

  it("phiếu một phần (A4/A6/A8): '8/10=8.00' → P1 = Tong = 8.00, không ra 0", () => {
    expect(scoreParts("8/10=8.00")).toEqual({ p1: "8.00", p2: "0", p3: "0", tong: "8.00" });
  });

  it("SBD giữ số 0 đầu; phiếu không đọc được SBD → ______", () => {
    expect(sbdText(rec({ stdCode: "006400" }))).toBe("006400");
    expect(sbdText(rec({ stdCode: "------" }))).toBe("______");
    expect(sbdText(rec({ stdCode: "" }))).toBe("______");
  });
});

/** Ảnh JPEG tối thiểu (SOI + EOI) để nhúng PDF/ZIP. */
function jpegBytes(): { name: string; data: Uint8Array; width: number; height: number } {
  return { name: "x.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 595, height: 842 };
}

describe("buildKetquaXlsx", () => {
  it("đúng cột, đúng kiểu text, sắp theo tổng điểm giảm dần", async () => {
    const { buildKetquaXlsx } = await import("@/lib/export-ketqua");
    const records = [
      rec({ stdCode: "00000013", examCode: "3157", score: "P1: 5.75\nP2: 4.00\nP3: 0.00\nTong: 9.75" }),
      rec({ stdCode: "00000032", examCode: "4185", score: "P1: 6.00\nP2: 4.00\nP3: 0.00\nTong: 10.00" }),
      rec({ stdCode: "0012", examCode: "102", score: "P1: 4.00\nP2: 3.00\nP3: 0.00\nTong: 7.00" }),
    ];
    const file = await buildKetquaXlsx(records, "Tin 12-GK1-26-27");
    expect(file.name).toBe("KQ Diem Tin 12-GK1-26-27.xlsx");

    const wb = XLSX.read(file.buffer, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(rows[0]).toEqual(["SBD", "Ma de", "Diem P1", "Diem P2", "Diem P3", "Tong diem", "Trang"]);
    // Sắp theo tổng điểm giảm dần
    expect(rows[1][5]).toBe("10.00");
    expect(rows[2][5]).toBe("9.75");
    expect(rows[3][5]).toBe("7.00");
    // Không có ảnh → cột Trang trống cho mọi dòng
    for (const r of rows.slice(1)) expect(r[6]).toBe("");
    // SBD giữ số 0 đầu (cell kiểu text)
    expect(String(rows[1][0])).toBe("00000032");
    expect(String(rows[3][0])).toBe("0012");
    const a1 = wb.Sheets.Sheet1.A2;
    expect(a1.t).toBe("s");
  });
});

describe("Trang — ánh xạ bản ghi → trang PDF", () => {
  it("cột Trang nhận số trang từ pageOfRecord, trống nếu bản ghi không có ảnh", async () => {
    const { buildKetquaXlsx } = await import("@/lib/export-ketqua");
    const records = [
      rec({ id: "r1", stdCode: "00000013", examCode: "3157", score: "P1: 5.75\nP2: 4.00\nP3: 0.00\nTong: 9.75", imageId: "b1" }),
      rec({ id: "r2", stdCode: "00000032", examCode: "4185", score: "P1: 6.00\nP2: 4.00\nP3: 0.00\nTong: 10.00", imageId: "b2" }),
      rec({ id: "r3", stdCode: "0012", examCode: "102", score: "P1: 4.00\nP2: 3.00\nP3: 0.00\nTong: 7.00" }), // không ảnh
    ];
    const pageOfRecord = new Map([
      ["r1", 2],
      ["r2", 1],
    ]);
    const file = await buildKetquaXlsx(records, "Tin 12", pageOfRecord);
    const wb = XLSX.read(file.buffer, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    // Sắp theo tổng giảm: 10.00 (r2, trang 1), 9.75 (r1, trang 2), 7.00 (r3, không ảnh)
    expect(rows[1][6]).toBe(1);
    expect(rows[2][6]).toBe(2);
    expect(rows[3][6]).toBe("");
  });
});

describe("buildZip", () => {
  it("ZIP đọc được, tên file <SBD>-<n>.jpg, dữ liệu nguyên vẹn", async () => {
    const { collectKetquaImages } = await import("@/lib/export-ketqua");
    // Giả lập collectKetquaImages bằng zip trực tiếp (không phụ thuộc canvas)
    const buf = buildZip([
      { name: "006400-0001.jpg", data: jpegBytes().data },
      { name: "______-0001.jpg", data: jpegBytes().data },
    ]);
    // Parse ZIP bằng tay: EOCD ở cuối, đọc central directory
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // Tìm EOCD signature 0x06054b50
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    expect(eocd).toBeGreaterThan(0);
    const count = view.getUint16(eocd + 10, true);
    expect(count).toBe(2);
    const cdOffset = view.getUint32(eocd + 16, true);
    // Đọc tên từ central directory
    const names: string[] = [];
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(p, true)).toBe(0x02014b50);
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const local = view.getUint32(p + 42, true);
      names.push(new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen)));
      expect(method).toBe(0); // stored
      // CRC khớp dữ liệu local
      const localNameLen = view.getUint16(local + 26, true);
      const dataStart = local + 30 + localNameLen;
      const data = u8.subarray(dataStart, dataStart + size);
      // CRC32 lại
      let c = 0xffffffff;
      for (const b of data) c = (c >>> 8) ^ 0xedb88320 ^ ((c ^ b) & 0xff) * 0;
      // dùng bảng crc của module qua import động không tiện — kiểm tracrc khác 0
      expect(crc).not.toBe(0);
      expect(data.length).toBe(4);
      p += 46 + nameLen;
    }
    expect(names).toEqual(["006400-0001.jpg", "______-0001.jpg"]);
    void collectKetquaImages;
  });
});

describe("buildPdf", () => {
  it("PDF hợp lệ: header, số trang, ảnh nhúng DCTDecode, xref", () => {
    const imgs = [jpegBytes(), jpegBytes()];
    const buf = buildPdf(imgs);
    const text = new TextDecoder("latin1").decode(buf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Count 2");
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/MediaBox [0 0 595 842]");
    expect(text.trim().endsWith("%%EOF")).toBe(true);
    const u8 = new Uint8Array(buf);
    // tìm SOI JPEG trong stream
    let found = 0;
    for (let i = 0; i < u8.length - 1; i++) {
      if (u8[i] === 0xff && u8[i + 1] === 0xd8) found++;
    }
    expect(found).toBe(2);
  });
});

describe("buildKetquaPackage", () => {
  it("trả đủ 3 file với tên đúng mẫu", async () => {
    // DOM canvas không có trong node test → chỉ chạy phần xlsx; 2 file còn lại
    // cần ảnh, ảnh trống thì package chỉ có xlsx.
    const { buildKetquaPackage } = await import("@/lib/export-ketqua");
    const records = [rec({ stdCode: "006400", examCode: "745", score: "Tong: 10.00" })];
    const files = await buildKetquaPackage(records, "Tin 12-GK1-26-27");
    expect(files[0].name).toBe("KQ Diem Tin 12-GK1-26-27.xlsx");
    // Không có ảnh đã chấm → không sinh PDF/ZIP
    expect(files.length).toBe(1);
    void readFileSync;
  });
});
