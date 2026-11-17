/**
 * Answer-key management: create quizzes, add/edit/delete keys, import CSV/XLSX,
 * decode share codes, grade scans — all mirroring the Android app flows.
 */

import { db, type KeyRecord, type QuizRecord, type ScoreRecord, type BlobRecord, type PaperTemplateRecord } from "./db";
import { gradeAnswers } from "./scoring";
import { decodeShareForQuiz, encodeShare, type ShareKey } from "./sharecode";
import type { FormKind } from "./omr/types";
import { canonicalSheet } from "./omr/sheet";
import { layoutAnswerSlots } from "./omr/giay-layouts";
import { parseWorkbookRows, type ParsedKey } from "./xlsx";

/* ---------------- Quizzes ---------------- */

export async function listQuizzes(): Promise<QuizRecord[]> {
  const all = await db.quizzes.orderBy("createdAt").toArray();
  // SQLite-ish: newest first (desc).
  return all.reverse();
}

export async function getQuiz(id: string): Promise<QuizRecord | undefined> {
  return db.quizzes.get(id);
}

export async function createQuiz(q: Omit<QuizRecord, "id">): Promise<QuizRecord> {
  const record: QuizRecord = { ...q, id: crypto.randomUUID(), createdAt: Date.now() };
  await db.quizzes.put(record);
  return record;
}

export async function updateQuiz(id: string, patch: Partial<QuizRecord>): Promise<void> {
  await db.quizzes.update(id, patch);
}

export async function deleteQuiz(id: string): Promise<void> {
  await db.transaction("rw", db.quizzes, db.keys, db.scores, db.blobs, async () => {
    const keys = await db.keys.where("quizId").equals(id).toArray();
    const keyIds = new Set(keys.map((k) => k.id));

    // Xoá mọi dòng chấm của bài thi này + marker đáp án (type=-1) của từng mã
    // đề. Marker của mã đề đã xoá trước đó (keyCode mồ côi) cũng phải dọn, nếu
    // không trang Kết quả còn bản ghi trỏ tới bài thi không tồn tại.
    const rows = await db.scores.where("quizId").equals(id).toArray();
    const markerIds = await db.scores
      .filter((s) => s.type === -1 && keyIds.has(s.keyCode))
      .toArray();
    const doomed = new Map<string, string | undefined>();
    for (const s of [...rows, ...markerIds]) if (s.id) doomed.set(s.id, s.imageId);

    await db.quizzes.delete(id);
    await db.keys.where("quizId").equals(id).delete();
    if (doomed.size) await db.scores.bulkDelete([...doomed.keys()]);
    const imageIds = [...doomed.values()].filter((v): v is string => !!v);
    if (imageIds.length) await db.blobs.bulkDelete(imageIds);
  });
}

/* ---------------- Keys ---------------- */

export async function listKeys(quizId: string): Promise<KeyRecord[]> {
  return db.keys.where("quizId").equals(quizId).sortBy("name");
}

export async function getKeyByName(quizId: string, name: string): Promise<KeyRecord | undefined> {
  const keys = await db.keys.where("quizId").equals(quizId).toArray();
  return keys.find((k) => k.name === name);
}

/**
 * Lưu đáp án của một mã đề và GIỮ ĐỒNG BỘ dòng marker (type=-1).
 *
 * Mọi đường sửa đáp án (nhập tay, CSV/XLSX, QR, mã chia sẻ) đều đi qua đây,
 * nên marker luôn phản ánh đáp án hiện tại — trước đây chỉ import mới tạo
 * marker, sửa tay xong marker vẫn giữ đáp án cũ.
 */
export async function saveKey(key: KeyRecord): Promise<void> {
  // put = insert HOẶC thay — key id được sinh trước đó nhưng chưa từng lưu
  // (vd importParsedKeys) vẫn ghi được; add() sẽ âm thầm không lưu gì khi id
  // đã tồn tại trong đối số nhưng chưa có trong bảng.
  const id = key.id ?? crypto.randomUUID();
  await db.keys.put({ ...key, id });

  const rows = await db.scores.where("keyCode").equals(id).toArray();
  const marker = rows.find((r) => r.type === -1);
  if (marker?.id) {
    await db.scores.update(marker.id, {
      answers: key.answers,
      examCode: key.name,
      time: Date.now(),
    });
  } else {
    // score record with type=-1 marks a key/answer entry.
    await db.scores.put({
      id: crypto.randomUUID(),
      quizId: key.quizId,
      keyCode: id,
      examCode: key.name,
      fileName: "",
      fileNameStudent: "",
      score: "",
      stdCode: "",
      answers: key.answers,
      type: -1,
      time: Date.now(),
    });
  }
}

export async function deleteKey(quizId: string, keyId: string): Promise<void> {
  await db.transaction("rw", db.keys, db.scores, async () => {
    await db.keys.where("id").equals(keyId).delete();
    // Remove the matching key marker row but keep actual grading records.
    const rows = await db.scores.where("keyCode").equals(keyId).toArray();
    const markers = rows.filter((r) => r.type === -1).map((r) => r.id).filter((v): v is string => !!v);
    if (markers.length) await db.scores.bulkDelete(markers);
  });
}

/* ---------------- Scoring ---------------- */

export function gradePaper(
  keyAnswers: number[],
  studentAnswers: number[],
  opts: { isSplit?: boolean; pointLadder?: string; maxScore?: number; parts?: { maxScore: number; count: number }[] },
) {
  return gradeAnswers(keyAnswers, studentAnswers, {
    isSplit: opts.isSplit,
    maxScore: opts.maxScore,
    parts: opts.parts,
  });
}

/* ---------------- Scores ---------------- */

export async function addScore(rec: Omit<ScoreRecord, "id">): Promise<ScoreRecord> {
  const record: ScoreRecord = { ...rec, id: crypto.randomUUID() };
  await db.scores.put(record);
  return record;
}

export async function updateScore(id: string, patch: Partial<ScoreRecord>): Promise<void> {
  await db.scores.update(id, patch);
}

export async function deleteScore(id: string): Promise<void> {
  await deleteScores([id]);
}

/**
 * Xoá nhiều bản ghi chấm trong MỘT transaction (dùng cho "Xoá đợt").
 * Ảnh đã chấm thuộc riêng từng bản ghi nên xoá luôn blob — nếu không DB phình
 * mãi sau mỗi đợt chấm bị bỏ.
 */
export async function deleteScores(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction("rw", db.scores, db.blobs, async () => {
    const recs = await db.scores.bulkGet(ids);
    await db.scores.bulkDelete(ids);
    const imageIds = recs.map((r) => r?.imageId).filter((v): v is string => !!v);
    if (imageIds.length) await db.blobs.bulkDelete(imageIds);
  });
}

export async function listScores(): Promise<ScoreRecord[]> {
  return db.scores.orderBy("time").reverse().toArray();
}

export async function listScoresByQuiz(quizId: string): Promise<ScoreRecord[]> {
  return db.scores.where("quizId").equals(quizId).reverse().sortBy("time");
}

/* ---------------- Blob images (annotated PNGs) ---------------- */

export async function saveBlob(name: string, mime: string, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const id = crypto.randomUUID();
  const rec: BlobRecord = { id, name, mime, data, createdAt: Date.now() };
  await db.blobs.put(rec);
  return id;
}

export async function getBlob(id: string): Promise<BlobRecord | undefined> {
  return db.blobs.get(id);
}

export async function deleteBlob(id: string): Promise<void> {
  await db.blobs.delete(id);
}

/* ---------------- Share codes ---------------- */

export function buildShare(keys: { code: string; answers: number[] }[], ansNumber: number): string {
  const shareKeys: ShareKey[] = keys.map((k) => ({ code: k.code, answers: k.answers }));
  return encodeShare(shareKeys, ansNumber);
}

export async function importShareCode(
  raw: string,
  quiz: QuizRecord,
): Promise<{ ok: boolean; error?: string; keys?: KeyRecord[] }> {
  const layoutForSlots = canonicalSheet({
    ansNumber: quiz.ansNumber,
    optionsPerQuestion: 4,
    form: quiz.form as never,
    useExamCode: true,
    useStudentCode: quiz.stdCode,
  });
  const decoded = await Promise.resolve(decodeShareForQuiz(raw, quiz.ansNumber, layoutAnswerSlots(layoutForSlots)));
  if (!decoded.ok || !decoded.keys) {
    return { ok: false, error: decoded.error ?? "Không đọc được mã chia sẻ" };
  }

  // Dùng CHUNG đường import với file Excel: gộp theo tên mã đề (import lại
  // không sinh bộ đáp án trùng) và chỉ thêm marker type=-1 cho mã đề mới.
  const res = await importParsedKeys(
    quiz.id!,
    "share-code",
    decoded.keys.map((k) => ({ name: k.code, answers: k.answers })),
  );
  if (!res.ok) return { ok: false, error: res.error };

  const keys = await db.keys.where("quizId").equals(quiz.id!).toArray();
  const wanted = new Set(decoded.keys.map((k) => k.code));
  return { ok: true, keys: keys.filter((k) => wanted.has(k.name)) };
}

/* ---------------- CSV / XLSX import ---------------- */

export interface KeyImportResult {
  ok: boolean;
  error?: string;
  imported?: number;
  skipped?: number;
  duplicate?: number;
}

/**
 * Import parsed key rows into a quiz. Rows whose exam code is not 3 digits
 * are skipped (counted), duplicates within the file are counted once.
 */
export async function importParsedKeys(
  quizId: string,
  fileName: string,
  parsed: ParsedKey[],
): Promise<KeyImportResult> {
  if (parsed.length === 0) return { ok: false, error: "Không đọc được dòng dữ liệu" };

  const quiz = await db.quizzes.get(quizId);
  if (!quiz) return { ok: false, error: "Không tìm thấy bài thi" };

  let imported = 0;
  let skipped = 0;
  let duplicate = 0;

  // Import lại cùng file (hoặc file đã sửa) phải GHI ĐÈ mã đề cũ cùng tên,
  // không tạo bản trùng — nếu không, sửa parser xong import lại sẽ ra 2 bộ.
  const existing = await db.keys.where("quizId").equals(quizId).toArray();
  const byName = new Map(existing.map((k) => [k.name, k]));

  const seen = new Set<string>();
  for (const p of parsed) {
    const code = p.name;
    if (seen.has(code)) {
      duplicate++;
      continue;
    }
    seen.add(code);
    const codeDigits = code.replace(/\D/g, "");
    if (codeDigits.length < 1 || codeDigits.length > 4) {
      skipped++;
      continue;
    }
    // Đủ số Ô của layout (GỒM ô dấu PHẦN III): quiz.ansNumber là số ô CŨ dùng
    // cho mã chia sẻ (96) — không cắt theo nó, kẻo mất ô dấu −/dấu thập phân.
    const keyLayout = canonicalSheet({
      ansNumber: quiz.ansNumber,
      optionsPerQuestion: 4,
      form: quiz.form as FormKind,
      useExamCode: true,
      useStudentCode: quiz.stdCode,
    });
    const slots = layoutAnswerSlots(keyLayout);
    const answers = p.answers.slice(0, slots);
    while (answers.length < slots) answers.push(-1);
    const prev = byName.get(code);
    const keyId = prev?.id ?? crypto.randomUUID();
    // saveKey đồng bộ luôn dòng marker (type=-1) — không tạo thêm ở đây.
    await saveKey({ id: keyId, quizId, name: code, answers });
    imported++;
  }

  return { ok: true, imported, skipped, duplicate };
}

/** Convenience: parse + import a CSV/XLSX File in one call. */
export async function importKeyFile(
  quizId: string,
  file: File,
): Promise<KeyImportResult> {
  const { parseKeyFile } = await import("./xlsx");
  const parsed = await parseKeyFile(file);
  return importParsedKeys(quizId, file.name, parsed);
}
/**
 * Import tự nhận diện định dạng: Smarttest (hàng = câu, cột = mã đề — file đáp án
 * chambaiV3) hoặc định dạng dọc/có sẵn.
 */
export async function importKeyFileAuto(
  quizId: string,
  file: File,
): Promise<KeyImportResult & { mode?: "smarttest" | "legacy"; codes?: string[] }> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = sheet
    ? (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" }) as unknown[][])
    : [];
  const header = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  // QM 2025 (app): hàng đầu "Đề\câu" — mỗi HÀNG = 1 mã đề, cột theo nhãn
  const h0 = header[0] ?? "";
  const isQm2025 = /^[\u0111d]/i.test(h0) && h0.includes("\\");
  const isSmarttest =
    !isQm2025 &&
    /c[\u00e2\u00e0a]u/i.test(header[0] ?? "") &&
    header.slice(1).filter((h) => /^\d{2,4}$/.test(h)).length >= 1;
  if (isQm2025) {
    const quiz = await db.quizzes.get(quizId);
    if (!quiz) return { ok: false, error: "Không tìm thấy bài thi" };
    const { parseQm2025Rows } = await import("./qm2025-import");
    const parsed = parseQm2025Rows(rows, quiz.form as FormKind, quiz.ansNumber);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const res = await importParsedKeys(
      quizId,
      file.name,
      parsed.keys.map((k) => ({ name: k.code, answers: k.answers })),
    );
    return { ...res, mode: "smarttest", codes: parsed.codes };
  }
  if (isSmarttest) {
    const quiz = await db.quizzes.get(quizId);
    if (!quiz) return { ok: false, error: "Không tìm thấy bài thi" };
    const { parseSmarttestRows } = await import("./smarttest-import");
    const parsed = parseSmarttestRows(rows, quiz.form as FormKind, quiz.ansNumber);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const res = await importParsedKeys(
      quizId,
      file.name,
      parsed.keys.map((k) => ({ name: k.code, answers: k.answers })),
    );
    return { ...res, mode: "smarttest", codes: parsed.codes };
  }
  const res = await importKeyFile(quizId, file);
  return { ...res, mode: "legacy" };
}

/* ---------------- Export ---------------- */

export interface BlobLike {
  name: string;
  buffer: ArrayBuffer;
}

/** Export grade records to an .xlsx workbook (SheetJS). */
export async function exportScoresXlsx(scores: ScoreRecord[]): Promise<BlobLike> {
  const XLSX = await import("xlsx");
  const rows = [
    ["keyCode", "fileName", "fileNameStudent", "score", "stdCode", "answers", "type", "time"],
    ...scores.map((s) => [
      s.keyCode,
      s.fileName,
      s.fileNameStudent,
      s.score,
      s.stdCode,
      JSON.stringify(s.answers),
      String(s.type),
      String(s.time),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "scores");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    name: `cham-thi-scores-${Date.now()}.xlsx`,
    buffer: out,
  };
}

/** Trigger a browser download for a generated file. */
/* ---------------- Mẫu phiếu (in) ---------------- */

/**
 * 4 mẫu giấy CHUẨN của hệ thống — hình học dùng cho cả việc chấm điểm nên
 * không cho xoá, chỉ cho ẩn. `form` khớp FormKind để bài thi tra được.
 *
 * Trang in hiện mẫu QM_A4 (nhãn có thể do người dùng đổi, ví dụ "Giấy khối 12
 * - TN THPT") và "Giấy khối 10 - 11". GIAY12 ("Giấy khối 12") và MOI bị ẩn
 * khỏi giao diện nhưng vẫn nằm nguyên trong DB (không xoá dữ liệu).
 */
export const BUILTIN_TEMPLATES: {
  form: string;
  name: string;
  title: string;
  size: string;
  ansNumber: number;
}[] = [
  { form: "QM_A4", name: "QM 2025 — A4 (Kiểm tra)", title: "PHIẾU TRẢ LỜI TRẮC NGHIỆM", size: "A4", ansNumber: 40 },
  { form: "GIAY12", name: "Giấy khối 12", title: "PHIẾU TRẢ LỜI TRẮC NGHIỆM", size: "A4", ansNumber: 40 },
  { form: "GIAY10_11", name: "Giấy khối 10 - 11", title: "PHIẾU TRẢ LỜI TRẮC NGHIỆM", size: "A4", ansNumber: 30 },
  { form: "MOI", name: "Mới 2025 (BGD2025)", title: "PHIẾU TRẢ LỜI TRẮC NGHIỆM", size: "A4", ansNumber: 20 },
];

/**
 * Mẫu chuẩn KHÔNG hiện trong danh sách in (GIAY12 + Mới 2025). Record vẫn giữ
 * nguyên trong DB (không xoá dữ liệu) — chỉ lọc ở giao diện.
 */
export const HIDDEN_TEMPLATE_FORMS = ["GIAY12", "MOI"];

/**
 * Nhãn mặc định CŨ, để lần đầu mở trang sau khi đổi tên thì đổi sang tên mới
 * mà không đè tên người dùng đã tự sửa.
 */
const LEGACY_NAMES: Record<string, string> = {
  GIAY12: "Giấy 12 (40 câu + 8 Đ/S + 6 số)",
  GIAY10_11: "QM 2025 — HSG (Giấy 10-11)",
};

/**
 * Danh sách mẫu phiếu (đã lọc mẫu ẩn). Việc tạo/đổi tên mẫu chuẩn do
 * `ensureTemplates()` (gọi trong useEffect) lo.
 */
export async function listTemplates(): Promise<PaperTemplateRecord[]> {
  // THUẦN ĐỌC — hàm này chạy trong querier của `useLiveQuery`, mà Dexie 4 ném
  // ReadOnly("Readwrite transaction in liveQuery context") nếu có ghi DB ở đây.
  const all = await db.templates.orderBy("createdAt").toArray();
  return all.filter((t) => !(t.builtin && HIDDEN_TEMPLATE_FORMS.includes(t.form)));
}

/**
 * Đồng bộ mẫu chuẩn khi mở trang (KHÔNG xoá record nào):
 *  - tạo lại mẫu chuẩn còn thiếu (id `builtin-<form>`);
 *  - đổi nhãn mẫu nếu vẫn còn tên mặc định cũ — không đè tên đã sửa tay.
 */
export async function ensureTemplates(): Promise<void> {
  for (const [i, t] of BUILTIN_TEMPLATES.entries()) {
    const id = `builtin-${t.form}`;
    const rec = await db.templates.get(id);
    if (!rec) {
      await db.templates.put({
        id,
        name: t.name,
        form: t.form,
        size: t.size,
        ansNumber: t.ansNumber,
        title: t.title,
        builtin: true,
        hidden: false,
        // Mẫu khôi phục xếp theo thứ tự chuẩn (0,1,2,3) để nằm trên cùng.
        createdAt: i,
      });
    } else if (rec.name === LEGACY_NAMES[t.form] && rec.name !== t.name) {
      await db.templates.update(id, { name: t.name });
    }
  }
}

export async function saveTemplate(t: Omit<PaperTemplateRecord, "id" | "createdAt"> & { id?: string }): Promise<PaperTemplateRecord> {
  if (t.id) {
    await db.templates.update(t.id, t);
    const cur = await db.templates.get(t.id);
    if (cur) return cur;
  }
  const record: PaperTemplateRecord = { ...t, id: crypto.randomUUID(), createdAt: Date.now() };
  await db.templates.put(record);
  return record;
}

/**
 * Xoá mẫu phiếu. Mẫu CHUẨN không xoá được (chấm điểm phụ thuộc hình học) —
 * trả lỗi để UI báo; mẫu chuẩn chỉ nên ẨN.
 */
export async function deleteTemplate(id: string): Promise<{ ok: boolean; error?: string }> {
  const rec = await db.templates.get(id);
  if (!rec) return { ok: false, error: "Không tìm thấy mẫu phiếu" };
  if (rec.builtin) {
    return { ok: false, error: "Mẫu giấy chuẩn không xoá được — hãy ẩn nếu không muốn in" };
  }
  await db.templates.delete(id);
  return { ok: true };
}

/** Ẩn/hiện mẫu trong danh sách chọn khi in (áp dụng cho cả mẫu chuẩn). */
export async function setTemplateHidden(id: string, hidden: boolean): Promise<void> {
  await db.templates.update(id, { hidden });
}

/**
 * Đổi tên hiển thị của mẫu phiếu. Chỉ sửa `name` (nhãn trong danh sách) —
 * hình học vẫn theo `form` nên đổi tên mẫu chuẩn không ảnh hưởng việc chấm.
 */
export async function setTemplateName(id: string, name: string): Promise<void> {
  await db.templates.update(id, { name });
}

export function downloadBlobLike(file: BlobLike, mime: string): void {
  const blob = new Blob([file.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
