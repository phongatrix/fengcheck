/**
 * Scoring, ported from the Android app's `cs.r`:
 *   correct = #(key != -1 && student != -1 && key == student)
 *   score   = round2(maxScore / total * correct)
 *   result  = "correct/total=score"
 */

export interface ScorePart {
  /** Maximum score for this part (point ladder entry). */
  maxScore: number;
  /** Number of questions covered by this part. */
  count: number;
}

export interface PartScore {
  correct: number;
  total: number;
  score: number;
  /** Max score for this part (from the ladder). */
  maxScore: number;
  text: string;
}

/** The app's `cs.v`: truncate to 3 decimals, round half-up, print with 2 decimals. */
export function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const thousandths = Math.trunc(abs * 1000);
  const third = thousandths % 10;
  const hundredths = Math.trunc(thousandths / 10) + (third < 5 ? 0 : 1);
  const rounded = (hundredths / 100) * sign;
  return rounded.toFixed(2);
}

/**
 * Score a contiguous slice of questions.
 *
 * `weights` (optional) cho phép điểm KHÔNG đều giữa các câu trong dải: mỗi câu
 * có trọng số riêng, điểm = maxScore × (tổng trọng số câu đúng / tổng trọng số
 * câu đáp án có). Bỏ trống ⇒ mọi câu bằng nhau, y như công thức gốc.
 */
export function scorePart(
  keyAnswers: number[],
  studentAnswers: number[],
  from: number,
  count: number,
  maxScore: number,
  opts: { keyDefinedTotal?: boolean; weights?: number[] | null } = {},
): PartScore {
  let correct = 0;
  let defined = 0;
  let weightDefined = 0;
  let weightCorrect = 0;
  const w = (i: number) => {
    const v = opts.weights?.[i];
    return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 1;
  };
  const end = Math.min(from + count, keyAnswers.length, studentAnswers.length);
  for (let i = from; i < end; i++) {
    const k = keyAnswers[i] ?? -1;
    const s = studentAnswers[i] ?? -1;
    if (k !== -1) {
      defined++;
      weightDefined += w(i);
    }
    if (k !== -1 && s !== -1 && k === s) {
      correct++;
      weightCorrect += w(i);
    }
  }
  // Phiếu in sẵn nhiều ô hơn số câu đề thực dùng (QM 2025: 18/40 câu P1).
  // Chấm trên số câu ĐÁP ÁN CÓ, nếu không mọi học sinh bị trừ điểm oan.
  // Phần mà đáp án bỏ trống hoàn toàn vẫn hiện đủ số ô như app gốc (0/24).
  const total = opts.keyDefinedTotal && defined > 0 ? defined : Math.max(0, count);
  // Có trọng số ⇒ chia điểm theo trọng số các câu ĐÁP ÁN CÓ (0 nếu phần trống).
  // Không có ⇒ công thức gốc maxScore/total×correct.
  const score = opts.weights
    ? weightDefined > 0
      ? (maxScore * weightCorrect) / weightDefined
      : 0
    : total > 0
      ? (maxScore / total) * correct
      : 0;
  return {
    correct,
    total,
    score,
    maxScore,
    text: `${correct}/${total}=${formatScore(score)}`,
  };
}

/** Tổng trọng số của các câu CÓ ĐÁP ÁN trong một dải — điểm tối đa thực tế. */
export function definedWeight(
  keyAnswers: number[],
  from: number,
  count: number,
  weights?: number[] | null,
): number {
  let sum = 0;
  const end = Math.min(from + count, keyAnswers.length);
  for (let i = from; i < end; i++) {
    if ((keyAnswers[i] ?? -1) === -1) continue;
    const v = weights?.[i];
    sum += Number.isFinite(v) && (v as number) > 0 ? (v as number) : 1;
  }
  return sum;
}

export interface GradeResult {
  parts: PartScore[];
  totalScore: number;
  correct: number;
  total: number;
  /** Multi-line string exactly like the original app stores. */
  text: string;
  /** Max achievable score (sum of part max scores). */
  maxScore: number;
}

export interface GradeOptions {
  /** Part definitions; when omitted the whole quiz is one part. */
  parts?: ScorePart[] | null;
  /** Split mode: grade in chunks of 40 (original isSplit behaviour). */
  isSplit?: boolean;
  /** Score for the whole quiz / each 40-question block. */
  maxScore?: number;
  /** Trọng số/điểm riêng từng câu (chỉ số câu, bỏ trống = chia đều). */
  weights?: number[] | null;
}

/**
 * Grade a paper. Mirrors `rr.n()`:
 *  - explicit `parts` (selectCourses) win,
 *  - otherwise `isSplit` grades 40-question blocks with the same ladder,
 *  - otherwise the whole paper is a single part.
 */
export function gradeAnswers(
  keyAnswers: number[],
  studentAnswers: number[],
  opts: GradeOptions = {},
): GradeResult {
  const ansNumber = keyAnswers.length;
  const defaultMax = opts.maxScore ?? 10;

  let parts: PartScore[];

  if (opts.parts && opts.parts.length > 0) {
    const list: PartScore[] = [];
    let from = 0;
    for (let i = 0; i < opts.parts.length; i++) {
      const p = opts.parts[i];
      const isLast = i === opts.parts.length - 1;
      const count = isLast ? Math.max(0, ansNumber - from) : Math.min(p.count, ansNumber - from);
      list.push(scorePart(keyAnswers, studentAnswers, from, count, p.maxScore, { weights: opts.weights }));
      from += count;
    }
    parts = list;
  } else if (opts.isSplit && ansNumber > 40) {
    const list: PartScore[] = [];
    for (let from = 0; from < ansNumber; from += 40) {
      const count = Math.min(40, ansNumber - from);
      list.push(scorePart(keyAnswers, studentAnswers, from, count, defaultMax, { weights: opts.weights }));
    }
    parts = list;
  } else {
    parts = [scorePart(keyAnswers, studentAnswers, 0, ansNumber, defaultMax, { weights: opts.weights })];
  }

  const totalScore = parts.reduce((s, p) => s + p.score, 0);
  const correct = parts.reduce((s, p) => s + p.correct, 0);
  const total = parts.reduce((s, p) => s + p.total, 0);
  const maxScore = parts.reduce((s, p) => s + (p.maxScore ?? 0), 0) || defaultMax;

  return {
    parts,
    totalScore,
    correct,
    total,
    text: parts.map((p) => p.text).join("\n"),
    maxScore,
  };
}

/* ------------------------------------------------------------------ */
/* Giấy 12 / Giấy 10-11 — chấm theo 3 phần, đúng format ứng dụng gốc:  */
/*   P1: 24/24 = 6.00                                                  */
/*   P2: 4/4; 4/4; 4/4; 4/4 = 4.00        (nhóm = 2 câu × 4 dòng Đ/S) */
/*   P3: 0/0 = 0.00                                                    */
/*   Tong: 10.00                                                       */
/* ------------------------------------------------------------------ */

export interface GiayCounts {
  /** PHẦN I câu count (4-option). */
  p1: number;
  /** PHẦN II câu count (each contributes 4 Đ/S sub-questions). */
  p2: number;
  /** PHẦN III câu count (each contributes 4 digit columns). */
  p3: number;
}

export interface GiayGradeResult {
  lines: string[];
  text: string;
  totalScore: number;
  correct: number;
  total: number;
}

export interface GiayGradeOptions {
  /**
   * Điểm/trọng số riêng từng ô (cùng thứ tự với vector đáp án: P1 câu, P2 từng
   * ý a–d, P3 từng cột chữ số). Bỏ trống ⇒ chia đều trong mỗi phần.
   */
  weights?: number[] | null;
  /**
   * Số câu PHẦN III có Ô DẤU (dấu − và dấu thập phân, 2 ô/câu) nằm sau các ô
   * chữ số của vector đáp án. Ô dấu là một phần của đáp án: tô thiếu/trật
   * dấu thập phân bị trừ theo đúng tỷ lệ ô đó trong câu.
   */
  p3SignCau?: number;
  /**
   * Điểm TUYỆT ĐỐI của từng ý a–d trong PHẦN II (mức 1,2,3,4 ý), dùng chung
   * cho mọi câu. Mỗi câu được điểm bằng TỔNG các ý đúng (đúng cả 4 ý = tổng
   * 4 mức) — đúng công thức Tổng PHẦN II = số câu × 1 điểm (mỗi câu 1 điểm).
   */
  p2Sub?: number[] | null;
  /**
   * Điểm từng ý RIÊNG cho từng câu PHẦN II: `p2Row[câu]` = [ý a, b, c, d].
   * Ưu tiên hơn `p2Sub` khi có. Câu không có dòng tương ứng → rơi về `p2Sub`.
   */
  p2Row?: number[][] | null;
  /**
   * Số câu IN trên phiếu (P1/P2/P3 của layout vừa đọc). `counts` chỉ là số câu
   * CẦN CHẤM (Thiết lập điểm có thể ít hơn số ô in) — OFFSET của từng phần
   * trong vector đáp án luôn theo số ô IN, không theo số câu chấm. Bỏ trống ⇒
   * coi `counts` là số ô in (tương thích cũ).
   */
  printed?: GiayCounts | null;
  /**
   * Tổng "điểm câu" KỲ VỌNG của PHẦN II (thường = maxes.p2). Chỉ truyền khi
   * phiếu vừa đọc có ÍT câu Đ/S hơn lúc nhập điểm (mẫu khác in ít câu hơn):
   * thang p2Sub/p2Row (điểm thật từng câu) được scale để bài đủ điểm = tổng kỳ
   * vọng. Bỏ trống ⇒ dùng thang tuyệt đối như người dùng nhập.
   */
  p2TopSum?: number | null;
}

/**
 * Chấm một TẬP Ô BẤT KỲ (theo chỉ số) của vector đáp án — dùng cho PHẦN III
 * vì ô chữ số và ô dấu không liền nhau khi phiếu in nhiều câu hơn số câu chấm.
 * Công thức giống scorePart: điểm = max × (ô đúng có đáp án / ô có đáp án),
 * có trọng số thì chia theo trọng số của các ô CÓ ĐÁP ÁN.
 */
/**
 * Chấm điểm theo NHÓM Ô (mỗi nhóm = một câu): điểm mỗi câu = maxScore/số câu
 * ĐÁP ÁN CÓ × (ô đúng có đáp án / ô có đáp án của câu). Có trọng số thì chia
 * theo trọng số các ô có đáp án trong câu (trọng số chỉ đổi tỉ lệ giữa các câu).
 */
function scoreCellGroups(
  keyAnswers: number[],
  studentAnswers: number[],
  groups: number[][],
  maxScore: number,
  weights: number[] | null,
): { correct: number; total: number; score: number } {
  let defined = 0;
  let correct = 0;
  let score = 0;
  // Đếm số câu CÓ ĐÁP ÁN để chia điểm — câu trống hoàn toàn không pha loãng.
  const rows = groups.map((idx) => {
    let d = 0;
    let c = 0;
    let wd = 0;
    let wc = 0;
    for (const i of idx) {
      const k = keyAnswers[i] ?? -1;
      const s = studentAnswers[i] ?? -1;
      const w =
        weights && Number.isFinite(weights[i]) && (weights[i] as number) > 0 ? (weights[i] as number) : 1;
      if (k !== -1) {
        d++;
        wd += w;
      }
      if (k !== -1 && s !== -1 && k === s) {
        c++;
        wc += w;
      }
    }
    return { d, c, wd, wc };
  });
  const definedRows = rows.filter((r) => r.d > 0).length;
  const perCau = definedRows > 0 ? maxScore / definedRows : 0;
  for (const r of rows) {
    defined += r.d;
    correct += r.c;
    if (r.d === 0) continue;
    score += perCau * (r.wd > 0 ? r.wc / r.wd : 0);
  }
  // Phần mà đáp án bỏ trống hoàn toàn vẫn hiện đủ số ô CHỮ SỐ như app gốc
  // (0/24), không tính ô dấu.
  const fallbackTotal = groups.reduce((n, idx) => n + Math.min(4, idx.length), 0);
  const total = defined > 0 ? defined : fallbackTotal;
  return { correct, total, score };
}

/**
 * Grade a 3-part sheet. `answers` = [P1 choices, P2 Đ/S subs, P3 digits].
 * Part max scores: p1Max for the whole PHẦN I, p2Max split across the câu
 * groups that the key actually covers, p3Max for the whole PHẦN III.
 *
 * Mẫu in có thể nhiều ô hơn đề dùng (QM 2025: 18/40 câu P1, 4/8 câu P2,
 * 6/10 câu P3) — điểm chia theo số câu CÓ TRONG ĐÁP ÁN, không theo số ô in.
 */
export function gradeGiay(
  counts: GiayCounts,
  key: number[],
  student: number[],
  maxes: { p1: number; p2: number; p3: number },
  opts: GiayGradeOptions = {},
): GiayGradeResult {
  // OFFSET từng phần theo số ô IN của phiếu; `counts` chỉ cắt số câu CHẤM.
  const printed = opts.printed ?? counts;
  const p2From = printed.p1;
  const p3From = printed.p1 + printed.p2 * 4;
  // Ô dấu PHẦN III nằm SAU toàn bộ ô chữ số in trên phiếu.
  const signBase = p3From + printed.p3 * 4;
  const keyDefined = { keyDefinedTotal: true, weights: opts.weights ?? null };
  const p1 = scorePart(key, student, 0, counts.p1, maxes.p1, keyDefined);
  const lines: string[] = [`P1: ${p1.correct}/${p1.total}=${formatScore(p1.score)}`];

  let p2Correct = 0;
  let p2Total = 0;
  let p2Score = 0;
  const groups: string[] = [];
  /**
   * PHẦN II — 4 ô điểm là THANG LUỸ TIẾN theo SỐ Ý ĐÚNG của một câu:
   *   trúng 1 ý → p2Sub[0] (vd 0.1)
   *   trúng 2 ý → p2Sub[1] (vd 0.25)
   *   trúng 3 ý → p2Sub[2] (vd 0.5)
   *   trúng 4 ý → p2Sub[3] (vd 1.0)
   * KHÔNG phải cộng dồn từng ý và KHÔNG chuẩn hoá theo tổng 4 ô: đúng 4/4
   * ý được đúng bằng ô "Điểm 4 ý" — đó là điểm tối đa của một câu.
   *
   * Câu có `p2Row` riêng thì dùng dòng đó thay cho p2Sub. Quiz KHÔNG cấu hình
   * thang (không p2Sub/p2Row) dùng THANG MẶC ĐỊNH [0.1, 0.25, 0.5, 1] — chấm
   * theo số ý đúng cho tất cả quiz (trước đây quiz không cấu hình bị chấm kiểu
   * từng ý khớp chia đều, sai so với cách tính của trường).
   *
   * Hiển thị theo NHÓM 2 CÂU như app gốc. Lặp theo TỪNG CÂU (bước 4 ô) chứ
   * không theo ô rời: số câu lẻ thì độ dài nhóm không chia hết cho 4, và
   * `k % 4` sẽ lệch pha — điểm ý d bị tính thành điểm ý b (bug đã sửa).
   */
  const DEFAULT_P2_LADDER = [0.1, 0.25, 0.5, 1];
  if (counts.p2 > 0) {
    // Thang mặc định của MỘT câu: hình dạng 0.1/0.25/0.5/1 scaled theo
    // "điểm 1 câu" = maxes.p2 / số câu CÓ ĐÁP ÁN (đề dùng 3/4 câu Đ/S thì
    // mỗi câu được đủ phần điểm của nó — câu đề không dùng không pha loãng).
    // Quiz có p2Sub/p2Row riêng thì dùng giá trị tuyệt đối người dùng nhập.
    let definedCau = 0;
    for (let c = 0; c < counts.p2; c++) {
      if (key.slice(p2From + c * 4, p2From + c * 4 + 4).some((v) => v !== undefined && v !== -1)) definedCau++;
    }
    const perCauTop = definedCau > 0 ? maxes.p2 / definedCau : maxes.p2 / Math.max(1, counts.p2);
    const rows = opts.p2Row ?? null;
    const sub0 = opts.p2Sub && opts.p2Sub.length === 4
      ? opts.p2Sub
      : DEFAULT_P2_LADDER.map((v) => v * perCauTop);
    /**
     * Thang 4 mức của MỘT câu (giá trị thô, chưa scale): ưu tiên dòng riêng,
     * không có thì p2Sub, không cấu hình thì thang mặc định.
     */
    const rawLadder = (c: number): number[] => {
      const row = rows?.[c];
      return Array.isArray(row) && row.length === 4 ? row : sub0;
    };
    /**
     * CHUẨN HOÁ thang: bài đủ điểm PHẢI bằng maxes.p2 (điểm tối đa của PHẦN II
     * do người dùng đặt). Thang cấu hình (p2Sub/p2Row) là điểm TƯƠNG ĐỐI từng
     * câu → scale giữ nguyên tỉ lệ giữa các câu.
     *
     * Trước đây chỉ scale khi caller truyền `p2TopSum` (workflow: partCount <
     * printed) nên bỏ sót trường hợp PHỔ BIẾN NHẤT: đáp án chỉ dùng 4/8 câu Đ/S
     * của mẫu (QM 2025) → sumTop = 4 nhưng maxes.p2 = 8, không scale → học sinh
     * giỏi nhất cũng chỉ được 4/8 điểm PHẦN II.
     *
     * Chỉ scale KHI THIẾU (sumTop < maxes.p2): thang người dùng nhập vẫn là
     * điểm thật — nếu họ đặt các mức cao hơn điểm tối đa của phần thì tôn trọng
     * đúng thang đó (test "thang là điểm thật"), còn khi đáp án dùng ít câu hơn
     * cấu hình thì bài đủ điểm phải chạm đúng điểm tối đa của phần.
     */
    let sumTop = 0;
    for (let c = 0; c < counts.p2; c++) {
      const anyDefined = key.slice(p2From + c * 4, p2From + c * 4 + 4).some((v) => v !== undefined && v !== -1);
      if (!anyDefined) continue;
      const top = rawLadder(c)[3];
      if (Number.isFinite(top) && top > 0) sumTop += top;
    }
    const expectedTop = opts.p2TopSum && opts.p2TopSum > 0 ? opts.p2TopSum : maxes.p2;
    const ladderScale = expectedTop > 0 && sumTop > 0 && sumTop < expectedTop ? expectedTop / sumTop : 1;
    /** Thang 4 mức đã chuẩn hoá của MỘT câu. */
    const ladderOf = (c: number): number[] => rawLadder(c).map((v) => v * ladderScale);
    const groupCount = Math.max(1, Math.ceil(counts.p2 / 2));
    for (let g = 0; g < groupCount; g++) {
      const qFrom = g * 2;
      const qTo = Math.min(counts.p2, qFrom + 2);
      let correct = 0;
      let defined = 0;
      let score = 0;
      for (let c = qFrom; c < qTo; c++) {
        const ladder = ladderOf(c);
        let qiumDefined = 0;
        let qCorrect = 0;
        for (let k = 0; k < 4; k++) {
          const i = p2From + c * 4 + k;
          const keyV = key[i] ?? -1;
          const stuV = student[i] ?? -1;
          if (keyV !== -1) {
            defined++;
            qiumDefined++;
          }
          if (keyV !== -1 && stuV !== -1 && keyV === stuV) {
            correct++;
            qCorrect++;
          }
        }
        if (qiumDefined === 0) continue;
        /**
         * Tra thang theo SỐ Ý ĐÚNG, nhưng quy về thang 4 mức theo số ý ĐÁP ÁN
         * CÓ: câu mà đáp án chỉ khai báo 3/4 ý thì đúng cả 3 ý vẫn phải được
         * mức 4 (điểm tối đa của câu) — trước đây lấy level = qCorrect = 3 nên
         * câu đó vĩnh viễn mất 1 mức, bài đủ điểm không chạm maxes.p2.
         * qCorrect === qiumDefined ⇒ mức 4; ngược lại scale theo tỉ lệ ý đúng.
         */
        const level =
          qCorrect <= 0
            ? 0
            : qCorrect >= qiumDefined
              ? 4
              : Math.max(1, Math.min(4, Math.round((4 * qCorrect) / qiumDefined)));
        const pts = level > 0 ? (Number.isFinite(ladder[level - 1]) && ladder[level - 1] > 0 ? ladder[level - 1] : 0) : 0;
        score += pts;
      }
      if (defined === 0) {
        groups.push("0/0=0.00");
        continue;
      }
      groups.push(`${correct}/${defined}=${formatScore(score)}`);
      p2Correct += correct;
      p2Total += defined;
      p2Score += score;
    }
    lines.push(`P2: ${groups.join("; ")}=${formatScore(p2Score)}`);
  } else {
    lines.push("P2: 0/0=0.00");
  }

  // Ô dấu PHẦN III (− / dấu thập phân): mỗi câu có dấu 2 ô, nằm SAU toàn bộ ô
  // chữ số IN TRÊN PHIẾU (không phải ngay sau số câu đang chấm nếu phiếu in
  // nhiều câu hơn số câu cần chấm). Chấm chung với ô chữ số theo tỉ lệ ô.
  /**
   * PHẦN III tính theo TỪNG CÂU rồi cộng lại — mỗi câu được `maxes.p3 / số câu
   * có đáp án`, chia đều cho các ô ĐÁP ÁN CÓ của chính câu đó. Nhờ vậy câu trả
   * lời âm/thập phân (có thêm 2 ô dấu) KHÔNG nặng hơn câu số nguyên dương —
   * trước đây chia đều trên toàn phần nên câu có dấu nặng 1.5× (6 ô so với 4).
   */
  const signCau = Math.min(opts.p3SignCau ?? 0, counts.p3);
  const p3Rows: number[][] = [];
  for (let c = 0; c < counts.p3; c++) {
    const row: number[] = [];
    for (let k = 0; k < 4; k++) row.push(p3From + c * 4 + k);
    if (c < signCau) row.push(signBase + c * 2, signBase + c * 2 + 1);
    p3Rows.push(row);
  }
  const p3 = scoreCellGroups(key, student, p3Rows, maxes.p3, opts.weights ?? null);
  lines.push(`P3: ${p3.correct}/${p3.total}=${formatScore(p3.score)}`);

  const totalScore = p1.score + p2Score + p3.score;
  lines.push(`Tong: ${formatScore(totalScore)}`);

  return {
    lines,
    text: lines.join("\n"),
    totalScore,
    correct: p1.correct + p2Correct + p3.correct,
    total: p1.total + p2Total + p3.total,
  };
}

/** Tỉ lệ mặc định của 3 phần mẫu Giấy (PHẦN I : II : III) — thang chuẩn của app. */
const GIAY_DEFAULT_RATIO = [6, 4, 0];

/**
 * Chia MỘT tổng điểm cho 3 phần của mẫu Giấy theo tỉ lệ chuẩn 6 : 4 : 0.
 * Dùng khi người dùng chỉ nhập một số (tổng điểm) thay vì ba phần.
 */
export function splitGiayTotal(total: number): [number, number, number] {
  const base = GIAY_DEFAULT_RATIO.reduce((s, v) => s + v, 0); // 10
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const parts = GIAY_DEFAULT_RATIO.map((v) => round((v * total) / base));
  // Giữ đúng tổng sau khi làm tròn: dồn phần lệch vào P2 (phần luôn có điểm).
  const diff = round(total - parts.reduce((s, v) => s + v, 0));
  parts[1] = round(parts[1] + diff);
  return [parts[0], parts[1], parts[2]];
}

/**
 * Parse "p1,p2,p3" part maxes, e.g. "6,4,0".
 *
 * Một con số duy nhất trên phiếu 3 phần là ĐIỂM CỦA CẢ BÀI, không phải điểm
 * PHẦN I: trước đây "10" → p1=10 còn p2 tự điền 4, nên bài 40 câu hiện
 * 0.25đ/câu mà tổng lại thành 14 — sai cả điểm lẫn tổng. Nay "10" → 6/4/0
 * (giữ đúng tổng 10). Hai số là (P1, P2), ba số trở lên đọc theo thứ tự.
 */
export function parsePartMaxes(ladder: string | undefined | null): { p1: number; p2: number; p3: number } {
  const values = (ladder ?? "")
    .split(/[,;\s]+/)
    .map((v) => Number.parseFloat(v.replace(",", ".")))
    .filter((v) => Number.isFinite(v) && v >= 0);

  if (values.length === 0) return { p1: 6, p2: 4, p3: 0 };
  if (values.length === 1) {
    const [p1, p2, p3] = splitGiayTotal(values[0]);
    return { p1, p2, p3 };
  }
  if (values.length === 2) return { p1: values[0], p2: values[1], p3: 0 };
  return { p1: values[0], p2: values[1], p3: values[2] };
}

/** Parse a point-ladder string such as "4,6" or "10" into part scores summing to `count`. */
export function parsePointLadder(ladder: string, count: number): ScorePart[] | null {
  const values = ladder
    .split(/[,;\s]+/)
    .map((v) => Number.parseFloat(v.replace(",", ".")))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (values.length === 0) return null;
  // Distribute questions as evenly as possible across parts.
  const base = Math.floor(count / values.length);
  const rest = count % values.length;
  return values.map((maxScore, i) => ({
    maxScore,
    count: base + (i < rest ? 1 : 0),
  }));
}
