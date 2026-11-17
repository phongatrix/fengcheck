/**
 * Answer-key share code, byte-compatible with the Android app:
 *
 *   "123456789" + "001" + <3-digit answer count> + for each key:
 *       <3-digit exam code> + <option digit per question>
 *
 * Example (2 keys, 5 questions):
 *   123456789001005 00101234 00232104
 *
 * `cs.p()` encodes, `cs.o()` decodes. Importing checks the question count
 * against the target quiz and refuses mismatches, exactly like the original.
 */

export const SHARE_PREFIX = "123456789";
/** Phiên bản gốc của app Android: mỗi ô 1 chữ số, 9 = "không tô". */
export const SHARE_VERSION = "001";
/**
 * Phiên bản mở rộng cho đáp án có Ô CHỮ SỐ PHẦN III. Bản 001 không biểu diễn
 * được chữ số 9 (9 bị hiểu là "không tô") nên đáp án "19.5" sẽ hỏng thành
 * "15". Bản 002 dùng bảng ký tự: 0-9 = chữ số, 'a' = ô trống (-1),
 * 'b' = tô đè (-2) — vẫn 1 ký tự/ô, cùng độ dài với 001.
 */
export const SHARE_VERSION_EXT = "002";

/** Mã hoá một ô đáp án theo bảng ký tự của từng phiên bản. */
function encodeCell(v: number, ext: boolean): string {
  if (ext) {
    if (v >= 0 && v <= 9) return String(v);
    return v === -2 ? "b" : "a";
  }
  return v >= 0 && v <= 9 ? String(v) : "9";
}

function decodeCell(ch: string, ext: boolean): number | null {
  // 001: '9' là "không tô" (sentinel của app gốc) — phải kiểm TRƯỚC khi parse
  // số, nếu không sẽ thành chữ số 9.
  if (!ext && ch === "9") return -1;
  const d = Number.parseInt(ch, 10);
  if (Number.isFinite(d)) return d;
  if (ext && ch === "a") return -1;
  if (ext && ch === "b") return -2;
  return null;
}

/** Number of options per question (A..D) — the app's fixed form. */
export const MAX_OPTIONS = 4;

export interface ShareKey {
  /** 3-digit exam code, e.g. "001". */
  code: string;
  /** Option index per question (0..3); -1 is written as 9 to keep the format fixed-width. */
  answers: number[];
}

export interface ShareDecodeResult {
  ok: boolean;
  error?: string;
  ansNumber?: number;
  keys?: ShareKey[];
}

/** Normalize an exam code to exactly 3 digits (the app pads with zeros). */
export function normalizeExamCode(raw: string | number): string {
  const s = String(raw).trim();
  const numeric = s.replace(/\.0+$/, "");
  const digits = numeric.replace(/\D/g, "");
  if (!digits) return "001";
  return digits.padStart(3, "0").slice(-3);
}

/** Encode all answer keys of a quiz into one share string. */
export function encodeShare(keys: ShareKey[], ansNumber: number): string {
  // Độ dài = max(ansNumber, độ dài thật của đáp án): key của mẫu có Ô DẤU
  // PHẦN III dài hơn số câu (96 câu + 12 ô dấu = 108) — cắt theo ansNumber
  // sẽ làm MẤT ô dấu và bên nhận chấm sai PHẦN III. Ô dấu ghi dạng số 0/1/9
  // nên vẫn đúng format cố định của app gốc.
  const n = keys.reduce((m, k) => Math.max(m, k.answers.length), ansNumber);
  /**
   * Có ô mang giá trị 9 (chữ số 9 của PHẦN III) hoặc tô đè (-2) thì PHẢI dùng
   * phiên bản mở rộng — bản 001 sẽ biến 9 thành "không tô" và làm sai đáp án.
   * Không có thì giữ 001 để app Android cũ đọc được.
   */
  const ext = keys.some((k) => k.answers.some((a) => a === 9 || a < -1));
  const version = ext ? SHARE_VERSION_EXT : SHARE_VERSION;
  const head = `${SHARE_PREFIX}${version}${String(n).padStart(3, "0")}`;
  const body = keys
    .map((k) => {
      const code = normalizeExamCode(k.code);
      const padded = k.answers.length < n ? [...k.answers, ...Array(n - k.answers.length).fill(-1)] : k.answers;
      const answers = padded
        .slice(0, n)
        .map((a) => encodeCell(a, ext))
        .join("");
      return code + answers;
    })
    .join("");
  return head + body;
}

/**
 * Decode a share string. Mirrors `cs.o()`:
 *  - must start with "123456789",
 *  - next 3 chars are the format version ("001"),
 *  - next 3 chars = answer count,
 *  - remaining length must be a multiple of (count + 3),
 *  - each block = 3-digit code + answers.
 */
export function decodeShare(raw: string): ShareDecodeResult {
  const str = (raw ?? "").trim();
  if (!str.startsWith(SHARE_PREFIX)) {
    return { ok: false, error: "Mã QR không hợp lệ (sai tiền tố)" };
  }
  // ĐỌC & KIỂM phiên bản: không được bỏ qua — mã của phiên bản khác (hoặc dữ
  // liệu lạc) sẽ bị hiểu sai vị trí số câu và "đọc được" toàn số rác.
  const version = str.slice(SHARE_PREFIX.length, SHARE_PREFIX.length + 3);
  if (version !== SHARE_VERSION && version !== SHARE_VERSION_EXT) {
    return { ok: false, error: `Mã chia sẻ phiên bản ${version || "?"} không hỗ trợ` };
  }
  const ext = version === SHARE_VERSION_EXT;
  const body = str.slice(SHARE_PREFIX.length + 3);
  if (body.length < 3) return { ok: false, error: "Mã chia sẻ quá ngắn" };

  const countStr = body.slice(0, 3);
  const ansNumber = Number.parseInt(countStr, 10);
  if (!Number.isFinite(ansNumber) || ansNumber <= 0 || ansNumber > 999) {
    return { ok: false, error: "Số câu trong mã không hợp lệ" };
  }

  const rest = body.slice(3);
  const blockLen = ansNumber + 3;
  if (rest.length === 0 || rest.length % blockLen !== 0) {
    return { ok: false, error: "Dữ liệu mã chia sẻ bị cắt hoặc sai định dạng" };
  }

  const keys: ShareKey[] = [];
  for (let i = 0; i < rest.length; i += blockLen) {
    const block = rest.slice(i, i + blockLen);
    const code = block.slice(0, 3);
    const digits = block.slice(3);
    const answers: number[] = [];
    let bad = false;
    for (const ch of digits) {
      const d = decodeCell(ch, ext);
      if (d === null) {
        bad = true;
        break;
      }
      answers.push(d);
    }
    if (bad) return { ok: false, error: `Đáp án không hợp lệ trong mã đề ${code}` };
    keys.push({ code, answers });
  }

  return { ok: true, ansNumber, keys };
}

/** Import check used by the UI before writing to the DB. */
export function decodeShareForQuiz(
  raw: string,
  quizAnsNumber: number,
  /** Độ dài vector đầy đủ của layout (gồm ô dấu PHẦN III) — mã "đầy đủ" hợp lệ. */
  fullSlots?: number,
): ShareDecodeResult {
  const res = decodeShare(raw);
  if (!res.ok) return res;
  const accepted = [quizAnsNumber, fullSlots].filter((v): v is number => typeof v === "number" && v > 0);
  if (!accepted.includes(res.ansNumber ?? -1)) {
    return {
      ok: false,
      error: `Số ô trong mã (${res.ansNumber}) không khớp với bài chấm (${quizAnsNumber}${fullSlots ? ` hoặc ${fullSlots} ô đầy đủ` : ""})`,
    };
  }
  return res;
}

/** Render answers as A/B/C/D letters for CSV/XLSX; blank answers become "-". */
export function answersToLetters(answers: number[]): string[] {
  return answers.map((a) => (a >= 0 && a < MAX_OPTIONS ? String.fromCharCode(65 + a) : "-"));
}

/** Parse letters back to indices; anything outside A..D (the app's options) becomes -1. */
export function lettersToAnswers(letters: (string | number | null | undefined)[]): number[] {
  return letters.map((raw) => {
    if (raw === null || raw === undefined) return -1;
    if (typeof raw === "number") return raw >= 0 && raw < MAX_OPTIONS ? raw : -1;
    const s = String(raw).trim().toUpperCase();
    if (!s) return -1;
    const idx = s.charCodeAt(0) - 65;
    return idx >= 0 && idx < MAX_OPTIONS ? idx : -1;
  });
}
