/**
 * Xuất kết quả chấm theo đúng định dạng thư mục "ketqua" của app gốc
 * (tulieuchambai/ketqua/Giay12, Giay10_11):
 *
 *   KQ Diem <tên bài>.xlsx — Sheet1: SBD | Ma de | Diem P1 | Diem P2 | Diem P3 | Tong diem | Trang
 *                            (SBD/Mã đề là chuỗi giữ số 0 đầu; sắp theo tổng điểm giảm dần;
 *                             Trang = số trang của phiếu đó trong file PDF kèm theo)
 *   <tên bài>.pdf          — mỗi trang A4 dọc = 1 phiếu đã chấm (ảnh annotation)
 *   <tên bài>.zip          — ảnh phiếu đã chấm đặt tên <SBD>-<n>.jpg
 *
 * Không dùng thư viện ngoài: ZIP (store) và PDF (JPEG DCTDecode) tự viết.
 */

import type { ScoreRecord, BlobRecord } from "./db";
import { getBlob } from "./store";

export interface KetquaFile {
  name: string;
  buffer: ArrayBuffer;
  mime: string;
}

/* --------------------- Điểm theo phần --------------------- */

export interface ScoreParts {
  p1: string;
  p2: string;
  p3: string;
  tong: string;
}

/**
 * Tách "P1: a/b=6.00\nP2: …\nP3: …\nTong: 10.00" thành 4 số.
 *
 * Phiếu KHÔNG chia phần (mẫu tự thiết kế A4/A6/A8) chỉ có một dòng
 * "8/10=8.00": khi đó cả 4 cột lấy đúng điểm đó chứ không trả 0 — nếu không,
 * file Excel xuất ra ghi 0 điểm cho mọi bài.
 */
export function scoreParts(scoreText: string | null): ScoreParts {
  const pick = (label: string) => {
    const line = (scoreText ?? "")
      .split("\n")
      .find((l) => l.startsWith(label));
    if (!line) return null;
    // "P2: 8/8=2.00; …=4.00" có nhiều dấu "=" → điểm là đoạn SAU "=" cuối.
    const eq = line.split("=");
    return (eq.length > 1 ? eq[eq.length - 1] : line.split(":")[1] ?? "").trim() || null;
  };
  const parts: ScoreParts = {
    p1: pick("P1:") ?? "",
    p2: pick("P2:") ?? "",
    p3: pick("P3:") ?? "",
    tong: pick("Tong:") ?? "",
  };
  if (parts.p1 || parts.p2 || parts.p3 || parts.tong) {
    return {
      p1: parts.p1 || "0",
      p2: parts.p2 || "0",
      p3: parts.p3 || "0",
      tong: parts.tong || "0",
    };
  }
  // Không có nhãn phần: điểm tổng là số sau dấu "=" cuối của cả khối.
  const flat = (scoreText ?? "").trim().split("\n").pop() ?? "";
  const eq = flat.lastIndexOf("=");
  const single = (eq >= 0 ? flat.slice(eq + 1) : flat).trim() || "0";
  return { p1: single, p2: "0", p3: "0", tong: single };
}

/** SBD dạng text: giữ số 0 đầu; phiếu không đọc được SBD → "______" như app gốc. */
export function sbdText(rec: ScoreRecord): string {
  const digits = (rec.stdCode ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : "______";
}

/* --------------------- XLSX --------------------- */

export async function buildKetquaXlsx(
  records: ScoreRecord[],
  quizName: string,
  /** Bản ghi → trang PDF (từ collectKetquaImages). Thiếu ⇒ cột Trang trống. */
  pageOfRecord?: Map<string, number>,
): Promise<KetquaFile> {
  const XLSX = await import("xlsx");
  const rows = records
    .map((rec) => ({ rec, parts: scoreParts(rec.score) }))
    .sort((a, b) => Number(b.parts.tong) - Number(a.parts.tong));
  const aoa: (string | number)[][] = [
    ["SBD", "Ma de", "Diem P1", "Diem P2", "Diem P3", "Tong diem", "Trang"],
    ...rows.map(({ rec, parts }) => {
      const page = rec.id ? pageOfRecord?.get(rec.id) : undefined;
      return [
        sbdText(rec),
        rec.examCode || "______",
        parts.p1,
        parts.p2,
        parts.p3,
        parts.tong,
        page ?? "",
      ];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // SBD / Mã đề phải là TEXT để giữ số 0 đầu (app gốc ghi với dấu nháy ').
  for (let r = 1; r < aoa.length; r++) {
    for (const col of ["A", "B"]) {
      const cell = ws[`${col}${r + 1}`];
      if (cell) cell.t = "s";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    name: `KQ Diem ${sanitize(quizName)}.xlsx`,
    buffer: out,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/* --------------------- Ảnh phiếu (JPEG) --------------------- */

export interface KetquaImage {
  /** Tên file theo app gốc: <SBD>-<n>.jpg */
  name: string;
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Đọc blob ảnh đã chấm của từng bản ghi và đổi sang JPEG.
 * Bản ghi không có ảnh bị bỏ qua (không có gì để xuất).
 */
export interface KetquaImagesResult {
  images: KetquaImage[];
  /**
   * Bản ghi → số TRANG trong file PDF (1-based, theo thứ tự xuất ảnh).
   * Bản ghi không có ảnh (hoặc ảnh lỗi) không có trang — cột "Trang" trên XLSX
   * sẽ trống cho những dòng đó.
   */
  pageOfRecord: Map<string, number>;
}

export async function collectKetquaImages(records: ScoreRecord[]): Promise<KetquaImagesResult> {
  const images: KetquaImage[] = [];
  const pageOfRecord = new Map<string, number>();
  const used = new Map<string, number>();
  for (const rec of records) {
    if (!rec.imageId) continue;
    const blobRec: BlobRecord | undefined = await getBlob(rec.imageId);
    if (!blobRec) continue;
    const jpeg = await toJpeg(blobRec);
    if (!jpeg) continue;
    const sbd = sbdText(rec);
    const nth = (used.get(sbd) ?? 0) + 1;
    used.set(sbd, nth);
    images.push({
      name: `${sbd}-${String(nth).padStart(4, "0")}.jpg`,
      data: jpeg.data,
      width: jpeg.width,
      height: jpeg.height,
    });
    // Trang PDF = số thứ tự ảnh xuất ra (mỗi ảnh 1 trang A4).
    if (rec.id) pageOfRecord.set(rec.id, images.length);
  }
  return { images, pageOfRecord };
}

/** PNG (hoặc bất kỳ ảnh nào browser đọc được) → JPEG bytes + kích thước. */
async function toJpeg(
  rec: BlobRecord,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const blob = new Blob([rec.data], { type: rec.mime });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
    if (!out) return null;
    return { data: new Uint8Array(await out.arrayBuffer()), width, height };
  } catch {
    return null;
  }
}

/* --------------------- ZIP (store, không nén) --------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

/** ZIP không nén (method 0) — ảnh JPEG vốn đã nén, dùng store cho đơn giản. */
export function buildZip(entries: { name: string; data: Uint8Array }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const listed: ZipEntry[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0, true); // date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    locals.push(local, e.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    listed.push({ name: nameBytes, crc, size, offset });
    offset += local.length + size;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, listed.length, true);
  ev.setUint16(10, listed.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of [...locals, ...central, end]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out.buffer;
}

/* --------------------- PDF (mỗi trang 1 ảnh phiếu) --------------------- */

/** PDF tối giản: mỗi trang A4 dọc nhúng 1 ảnh JPEG (DCTDecode). */
export function buildPdf(images: KetquaImage[]): ArrayBuffer {
  if (images.length === 0) {
    throw new Error("Không có ảnh phiếu nào để xuất PDF");
  }
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const write = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? enc.encode(s) : s;
    parts.push(bytes);
    pos += bytes.length;
  };
  const emitObj = (num: number, content: string | Uint8Array) => {
    offsets[num] = pos;
    write(`${num} 0 obj\n`);
    write(content);
    write("\nendobj\n");
  };

  write("%PDF-1.4\n");

  const pageCount = Math.max(1, images.length);
  const wPt = 595;
  const hPt = 842;
  const margin = 12;
  const drawW = wPt - margin * 2;
  const drawH = hPt - margin * 2;
  const objNumOf = (pageIdx: number, kind: "page" | "img" | "content") =>
    3 + pageIdx * 3 + (kind === "page" ? 0 : kind === "img" ? 1 : 2);

  emitObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  emitObj(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${objNumOf(i, "page")} 0 R`).join(" ")}] /Count ${pageCount} >>`);

  for (let i = 0; i < pageCount; i++) {
    const img = images[i];
    const imgNum = objNumOf(i, "img");
    const page = objNumOf(i, "page");
    const contentNum = objNumOf(i, "content");

    const iw = img.width ?? drawW;
    const ih = img.height ?? drawH;
    const scale = Math.min(drawW / iw, drawH / ih, 1);
    const w = iw * scale;
    const h = ih * scale;
    const x = (wPt - w) / 2;
    const y = (hPt - h) / 2;
    const draw = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q`;

    emitObj(
      imgNum,
      `<< /Type /XObject /Subtype /Image /Width ${img.width ?? iw} /Height ${img.height ?? ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`,
    );
    write(img.data);
    // endstream BẮT BUỘC đóng stream ảnh (thiếu → PDF hỏng, không mở được).
    write("\nendstream\nendobj\n");

    emitObj(contentNum, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    emitObj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im${i} ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>`);
  }

  const xrefPos = pos;
  const total = 3 + pageCount * 3;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) {
    xref += `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  write(xref);
  write(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

/* --------------------- Gói xuất --------------------- */

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "cham-thi";
}

/**
 * Gói xuất đầy đủ (3 file) như thư mục ketqua của app gốc.
 * Trả về mảng file để trình duyệt tải lần lượt.
 */
export async function buildKetquaPackage(
  records: ScoreRecord[],
  quizName: string,
): Promise<KetquaFile[]> {
  const base = sanitize(quizName);
  const files: KetquaFile[] = [];

  // Thu ảnh TRƯỚC: số trang PDF phụ thuộc ảnh có mặt, mà XLSX cần cột "Trang"
  // tham chiếu đúng trang của từng phiếu trong file PDF kèm theo.
  const { images, pageOfRecord } = await collectKetquaImages(records);

  files.push(await buildKetquaXlsx(records, quizName, pageOfRecord));

  if (images.length > 0) {
    files.push({
      name: `${base}.pdf`,
      buffer: buildPdf(images),
      mime: "application/pdf",
    });
    files.push({
      name: `${base}.zip`,
      buffer: buildZip(images.map((im) => ({ name: im.name, data: im.data }))),
      mime: "application/zip",
    });
  }
  return files;
}
