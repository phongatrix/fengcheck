/**
 * Tách danh sách bản ghi chấm thành các "đợt chấm" cho trang Kết quả.
 *
 * Quy tắc:
 *  1. Mỗi LƯỢT upload nhiều ảnh (cùng `sessionId`) là MỘT đợt riêng — trong
 *     cùng một ngày, hai lượt upload cách nhau vài phút vẫn là hai đợt.
 *  2. Bản ghi chấm lẻ (camera, không có `sessionId`) gộp theo thời gian: liền
 *     nhau ≤ gapMs (mặc định 30 phút) thì cùng một đợt.
 *  3. Đợt MỚI NHẤT đứng đầu (đợt hiện hành ở trên, đợt trước ở dưới).
 */

export interface SessionRow {
  id?: string;
  time: number;
  score?: string;
  stdCode?: string;
  sessionId?: string;
  quizId?: string;
}

export interface SessionGroup<T extends SessionRow> {
  key: string;
  start: number;
  end: number;
  /** true = đợt sinh từ một lượt upload nhiều ảnh. */
  batch: boolean;
  records: T[];
}

export function groupBySession<T extends SessionRow>(
  records: T[],
  gapMs = 30 * 60 * 1000,
): SessionGroup<T>[] {
  const groups: SessionGroup<T>[] = [];
  if (records.length === 0) return groups;

  // 1) Nhóm theo (mã đợt, BÀI THI): cùng một mã đợt nhưng khác bài thi (đổi
  //    bài thi giữa buổi, hoặc bản ghi cũ dùng chung mã) phải tách đợt — nếu
  //    không, tiêu đề đợt và file xuất trộn kết quả hai kỳ thi.
  const byId = new Map<string, T[]>();
  const loose: T[] = [];
  for (const r of records) {
    if (r.sessionId) {
      const key = `${r.sessionId}|${r.quizId ?? ""}`;
      const list = byId.get(key);
      if (list) list.push(r);
      else byId.set(key, [r]);
    } else loose.push(r);
  }
  for (const [key, list] of byId) {
    const times = list.map((r) => r.time);
    groups.push({ key, start: Math.min(...times), end: Math.max(...times), batch: true, records: list });
  }

  // 2) Bản ghi lẻ → gộp theo thời gian, TÁCH RIÊNG THEO BÀI THI: hai bài thi
  //    khác nhau chấm liền nhau không được nằm chung một đợt (tiêu đề đợt chỉ
  //    hiện được một tên bài, và nút "Xuất đợt" sẽ trộn kết quả hai kỳ thi).
  if (loose.length > 0) {
    const byQuiz = new Map<string, T[]>();
    for (const r of loose) {
      const q = r.quizId ?? "";
      const list = byQuiz.get(q);
      if (list) list.push(r);
      else byQuiz.set(q, [r]);
    }
    for (const [quizId, list] of byQuiz) {
      const sorted = [...list].sort((a, b) => a.time - b.time);
      let cur: SessionGroup<T> = {
        key: `t-${quizId}-${sorted[0].time}`,
        start: sorted[0].time,
        end: sorted[0].time,
        batch: false,
        records: [sorted[0]],
      };
      for (let i = 1; i < sorted.length; i++) {
        const t = sorted[i].time;
        if (t - cur.end <= gapMs) {
          cur.end = t;
          cur.records.push(sorted[i]);
        } else {
          groups.push(cur);
          cur = { key: `t-${quizId}-${t}`, start: t, end: t, batch: false, records: [sorted[i]] };
        }
      }
      groups.push(cur);
    }
  }

  // 3) Đợt mới nhất lên trên.
  return groups.sort((a, b) => b.end - a.end);
}

/** Nhãn thời gian của một đợt: "14:30 – 14:45" hoặc một mốc nếu rất ngắn. */
export function sessionLabel(start: number, end: number): string {
  const date = new Date(start).toLocaleDateString("vi-VN");
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const time = end - start < 60 * 1000 ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  return `${time} · ${date}`;
}

/**
 * Thứ tự trong một đợt: bài CÓ điểm xếp trước, bài KHÔNG có điểm xếp cuối;
 * trong mỗi nhóm sắp theo SBD tăng dần (SBD rỗng/không đọc được xuống cuối),
 * cùng SBD thì bài chấm muộn hơn đứng trước.
 *
 * "Có điểm" xét chuỗi điểm không rỗng (không chỉ dòng "Tong:") — phiếu một
 * phần chỉ có "8/10=8.00".
 */
export function sortBatch<T extends SessionRow>(records: T[]): T[] {
  const sbdKey = (s: T) => {
    const digits = (s.stdCode ?? "").replace(/\D/g, "");
    return digits.length > 0 ? Number.parseInt(digits, 10) : Number.MAX_SAFE_INTEGER;
  };
  const hasScore = (s: T) => (s.score ?? "").trim().length > 0;
  return [...records].sort((a, b) => {
    const ta = hasScore(a) ? 1 : 0;
    const tb = hasScore(b) ? 1 : 0;
    if (ta !== tb) return tb - ta; // có điểm trước
    const sa = sbdKey(a);
    const sb = sbdKey(b);
    if (sa !== sb) return sa - sb; // SBD tăng dần
    return b.time - a.time;
  });
}
