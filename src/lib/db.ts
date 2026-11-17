/**
 * Local database mirroring the Android app's `tf0`/`xx` helper schema:
 *   score(id, keyCode, fileName, fileNameStudent, score, stdCode, answers, type, time)
 *   quiz (id, name, ansNumber, form, isSplit, pointLadder, stdCode, selectCourses)
 *   key   (id, quizId, name, answers)
 *
 * IndexedDB via Dexie. Blob storage is an optional Dexie table for the
 * annotated PNGs (`images/{uuid}.png`) since browsers can't write to disk.
 */

import Dexie, { Table } from "dexie";

export interface QuizRecord {
  id?: string;
  name: string;
  ansNumber: number;
  form: string;
  isSplit: boolean;
  pointLadder: string;
  stdCode: boolean;
  selectCourses: string; // JSON
  /**
   * Điểm thiết lập riêng (Quản lý đáp án → Thiết lập điểm):
   *   partMax  : điểm TỔNG từng phần (giấy: [P1,P2,P3]) = partCount × điểm/câu.
   *   partCount: số lượng câu từng phần (người dùng nhập; mặc định theo mẫu).
   *   p2Sub    : điểm từng ý a,b,c,d của PHẦN II (dùng chung cho mọi câu);
   *              tổng PHẦN II = partCount[1] × 1 điểm (mỗi câu 1 điểm).
   *   p2Row    : điểm từng ý RIÊNG cho từng câu PHẦN II — mỗi dòng (câu) một
   *              mảng 4 số. Ưu tiên hơn p2Sub khi chấm.
   *   perCau   : điểm từng câu theo không gian câu (P1 1..N, P2 1..M, P3 1..K);
   *              null = câu đó chia đều theo phần.
   */
  points?: {
    partMax: number[];
    partCount?: number[];
    p2Sub?: number[];
    p2Row?: number[][];
    perCau?: (number | null)[] | null;
  };
  createdAt?: number;
}

export interface KeyRecord {
  id?: string;
  quizId: string;
  name: string; // exam code, 3 digits
  answers: number[]; // per-question option indices
}

export interface ScoreRecord {
  id?: string;
  /** Quiz this record belongs to (explicit index — listing/filtering). */
  quizId: string;
  /** Key record id used for grading ("" when no key matched). */
  keyCode: string;
  /** 3-digit exam code read from the sheet ("" when absent). */
  examCode: string;
  fileName: string;
  fileNameStudent: string;
  score: string;
  stdCode: string;
  answers: number[];
  type: number;
  time: number;
  /** Mã đề SUY NGƯỢC từ lưới đáp án (ô mã đề mờ/không đọc được). */
  codeInferred?: boolean;
  /**
   * Mẫu giấy THỰC của phiếu đã đọc (worker tự nhận diện, có thể khác `quiz.form`).
   * `answers` được lưu đúng theo layout này nên trang Kết quả phải dùng nó để
   * hiển thị/đọc lại đáp án; thiếu nó thì PHẦN III hiện sai.
   */
  layoutKind?: string;
  /** Mã đợt chấm: mỗi lượt upload / buổi chấm liên tục một mã, để trang kết quả tách đợt. */
  sessionId?: string;
  /** Blob id of the annotated PNG in the blobs table. */
  imageId?: string;
}

/**
 * Mẫu phiếu để IN (trang "Mẫu phiếu"). Người dùng thêm/xoá được các mẫu tự
 * thiết kế; 4 mẫu giấy chuẩn (QM_A4 / Giấy 12 / Giấy 10-11 / Mới 2025) là
 * `builtin` — không xoá được vì bài thi và bộ chấm dùng hình học của chúng,
 * chỉ có thể ẨN khỏi danh sách in.
 */
export interface PaperTemplateRecord {
  id?: string;
  /** Tên hiển thị, vd "Phiếu 40 câu A4". */
  name: string;
  /** Loại hình học dùng để sinh phiếu (cũng là `form` của bài thi). */
  form: string;
  /** Khổ giấy in: A4 / A6 / A8. */
  size: string;
  /** Số câu in trên phiếu (mẫu tự thiết kế dùng để dựng lưới). */
  ansNumber: number;
  /** Tiêu đề in trên đầu phiếu. */
  title: string;
  /** Mẫu giấy chuẩn của hệ thống — không xoá được, chỉ ẩn. */
  builtin: boolean;
  /** Ẩn khỏi danh sách chọn (vẫn giữ để bài thi cũ dùng). */
  hidden: boolean;
  createdAt: number;
}

export interface BlobRecord {
  id?: string;
  name: string;
  mime: string;
  data: Uint8Array<ArrayBuffer>;
  createdAt: number;
}

class ChamBaiDB extends Dexie {
  quizzes!: Table<QuizRecord, string>;
  keys!: Table<KeyRecord, string>;
  scores!: Table<ScoreRecord, string>;
  blobs!: Table<BlobRecord, string>;
  templates!: Table<PaperTemplateRecord, string>;

  constructor() {
    super("chambai-webcam"); // tài liệu DB cũ "chambai" (v10, từ app khác cùng origin) gây xung đột schema
    const SCHEMA = {
      quizzes: "id, createdAt",
      keys: "id, quizId, name",
      scores: "id, keyCode, time, stdCode, quizId",
      blobs: "id, name, createdAt",
    };
    this.version(1).stores(SCHEMA);
    // Bản cài cũ đã nâng DB lên version 10 (đổi tên DB + index). Khai báo THẤP
    // hơn version thực tế làm Dexie ném VersionError khi mở → mọi useLiveQuery
    // trả undefined và giao diện kẹt "Đang tải..." vĩnh viễn. Khai báo đúng
    // version hiện hành (schema y hệt) để mở được cả DB cũ lẫn DB mới tạo.
    this.version(10).stores(SCHEMA);
    // v11: thêm bảng mẫu phiếu in được (thêm/xoá mẫu ở trang "Mẫu phiếu").
    this.version(11).stores({ ...SCHEMA, templates: "id, createdAt" });
  }
}

export const db = new ChamBaiDB();

export const isDbReady = db.open().then(() => true).catch(() => false);
