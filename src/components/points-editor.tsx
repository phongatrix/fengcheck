"use client";

/**
 * Thiết lập điểm cho một bài thi (Quản lý đáp án → Thiết lập điểm).
 *
 * Mỗi phần chỉ còn BA con số: SỐ LƯỢNG CÂU × ĐIỂM 1 CÂU = TỔNG ĐIỂM.
 * Tổng điểm là giá trị DẪN XUẤT (không nhập tay) nên luôn khớp với hai số kia —
 * sửa số câu hay điểm/câu thì tổng đổi ngay.
 *
 * Điểm từng câu là tương đối trong phần: khi chấm, điểm phần được chia theo
 * số câu ĐÁP ÁN CÓ, nên đổi số lượng câu in trên phiếu không làm lệch điểm.
 */

import { useEffect, useMemo, useState } from "react";
import { updateQuiz } from "@/lib/store";
import { cauCountsForQuiz, distribute, pointsOf, type CauCounts } from "@/lib/points";
import type { QuizRecord } from "@/lib/db";
import type { SheetLayout } from "@/lib/omr/types";

const PART_LABELS = ["PHẦN I", "PHẦN II", "PHẦN III"];

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return String(Math.round(v * 10000) / 10000);
}

function parseNum(s: string): number {
  const v = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Một phần của bài thi: nhãn + dải câu trong KHÔNG GIAN CÂU + chỉ số điểm phần. */
interface PartDef {
  label: string;
  /** Chỉ số trong `partMax`. */
  pi: number;
  /** Câu đầu tiên (0-based, không gian câu). */
  from: number;
  count: number;
  kind: "p1" | "p2" | "p3";
}

function partsOf(cau: CauCounts, nParts: number): PartDef[] {
  if (cau.p2 + cau.p3 > 0) {
    return [
      { label: "PHẦN I", pi: 0, from: 0, count: cau.p1, kind: "p1" },
      { label: "PHẦN II", pi: 1, from: cau.p1, count: cau.p2, kind: "p2" },
      { label: "PHẦN III", pi: 2, from: cau.p1 + cau.p2, count: cau.p3, kind: "p3" },
    ];
  }
  // Phiếu thường: chia câu theo thang điểm các phần (vd "4,6" → 2 phần) — dùng
  // CÙNG công thức `distribute` như lúc chấm (câu lẻ dồn về phần ĐẦU).
  const defs: PartDef[] = [];
  let from = 0;
  distribute(cau.p1, new Array(Math.max(1, nParts)).fill(0)).forEach((p, i) => {
    const len = Math.min(p.count, Math.max(0, cau.p1 - from));
    defs.push({
      label: nParts > 1 ? `PHẦN ${i + 1}` : "TOÀN BÀI",
      pi: i,
      from,
      count: len,
      kind: "p1",
    });
    from += len;
  });
  return defs;
}

export function PointsEditor({ quiz, layout }: { quiz: QuizRecord; layout: SheetLayout | null }) {
  const cau = useMemo(() => cauCountsForQuiz(quiz, layout), [quiz, layout]);
  const initial = useMemo(() => pointsOf(quiz, layout), [quiz, layout]);
  const parts = useMemo(() => partsOf(cau, initial.partMax.length), [cau, initial]);

  /** Số câu và điểm 1 câu của từng phần — hai giá trị người dùng nhập. */
  const [counts, setCounts] = useState<string[]>([]);
  const [perQ, setPerQ] = useState<string[]>([]);
  /**
   * PHẦN II: mỗi câu một DÒNG, mỗi dòng 4 ô = thang điểm luỹ tiến theo số ý
   * đúng (1 ý / 2 ý / 3 ý / 4 ý). `p2Rows[câu]` = 4 chuỗi điểm của câu đó.
   */
  const [p2Rows, setP2Rows] = useState<string[][]>([]);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Thang mặc định cho MỘT câu PHẦN II — luỹ tiến theo số ý đúng:
   * trúng 1 ý = 0.1, 2 ý = 0.25, 3 ý = 0.5, 4 ý = 1.0 (mức tối đa 1 câu).
   * Chỉ dùng khi câu đó chưa có cấu hình riêng trong DB.
   */
  const defaultP2Row = (): string[] => ["0.1", "0.25", "0.5", "1"];

  const load = () => {
    setCounts(
      parts.map((p) => {
        const stored = initial.partCount?.[p.pi];
        return String(Number.isFinite(stored) ? stored : p.count);
      }),
    );
    setPerQ(
      parts.map((p) => {
        const n = initial.partCount?.[p.pi] ?? p.count;
        const max = initial.partMax[p.pi] ?? 0;
        return n > 0 ? fmt(max / n) : fmt(max);
      }),
    );
    // PHẦN II: nạp thang điểm từng câu. Ưu tiên p2Row (điểm riêng từng dòng),
    // không có thì dùng p2Sub chung cho mọi câu, cuối cùng mới suy ra từ điểm
    // 1 câu. Xét `kind` chứ không xét chỉ số pi — phiếu A4 nhiều phần cũng có
    // phần thứ hai (pi = 1) nhưng mỗi câu chỉ một đáp án.
    const p2 = parts.find((p) => p.kind === "p2" && p.count > 0);
    const n2 = p2 ? Math.round(initial.partCount?.[p2.pi] ?? p2.count) : 0;
    const stored = initial.p2Sub;
    const fallback = stored?.length === 4 ? stored.map(fmt) : defaultP2Row();
    const storedRows = initial.p2Row;
    setP2Rows(
      Array.from({ length: Math.max(0, n2) }, (_, c) => {
        const row = storedRows?.[c];
        return Array.isArray(row) && row.length === 4 ? row.map(fmt) : [...fallback];
      }),
    );
  };

  // Đổi bài thi / đổi cấu hình trong DB → nạp lại giá trị.
  const sig = `${quiz.id}|${parts.map((p) => p.count).join(",")}|${initial.partMax.join(",")}|${(initial.partCount ?? []).join(",")}`;
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  /**
   * PHẦN II thực của mẫu Giấy (mỗi câu 4 ý a–d). Phải xét `kind`, KHÔNG xét chỉ
   * số `pi`: phiếu A4 chia 2 phần cũng có phần thứ hai (pi = 1) nhưng mỗi câu
   * chỉ 1 đáp án — dùng pi sẽ hiện nhầm 4 ô "Điểm N ý".
   */
  const p2Part = parts.find((p) => p.kind === "p2" && p.count > 0);
  const hasP2 = !!p2Part;
  /**
   * Số thứ tự ô ĐẦU TIÊN của PHẦN II trong vector đáp án. PHẦN I có `p1` câu
   * nên câu PHẦN II đầu tiên là câu `p1 + 1` (mẫu 40 câu → 41), và mỗi dòng
   * chiếm 4 ô liên tiếp: 41–44, 45–48, 49–52…
   */
  const p2FirstNumber = (cau.p1 ?? 0) + 1;

  const totalOf = (i: number) => {
    // PHẦN II: mỗi câu đúng 4/4 ý nhận mức "4 ý" của DÒNG đó, nên tổng cả
    // phần = cộng mức 4 ý của từng dòng. Mặc định mọi dòng là 1 điểm nên tổng
    // = số câu; câu nào đặt mức khác thì tổng theo đúng dòng đó. Sửa số câu
    // thì danh sách dòng đổi theo và tổng đổi ngay.
    if (hasP2 && p2Part?.pi === i) {
      const n = Math.max(0, Math.round(parseNum(counts[i] ?? "0")));
      const fallback = parseNum(p2Rows[0]?.[3] ?? "0");
      let sum = 0;
      for (let c = 0; c < n; c++) {
        sum += parseNum((p2Rows[c] ?? p2Rows[0])?.[3] ?? String(fallback));
      }
      return sum;
    }
    return parseNum(counts[i] ?? "0") * parseNum(perQ[i] ?? "0");
  };
  const grand = parts.reduce((s, p) => s + totalOf(p.pi), 0);

  const save = async () => {
    const maxes = parts.map((p) => totalOf(p.pi));
    // Ô số câu để trắng = "không đặt" → lưu số câu của MẪU, không lưu 0 (0 sẽ
    // làm cả phần thành 0/0, học sinh mất trắng điểm phần đó).
    const partCount = parts.map((p) => {
      const n = Math.round(parseNum(counts[p.pi] ?? "0"));
      return n > 0 ? n : p.count;
    });
    await updateQuiz(quiz.id!, {
      // perCau = null: mọi câu trong phần chia đều điểm của phần.
      points: {
        partMax: maxes,
        perCau: null,
        partCount,
        p2Row: hasP2 ? p2Rows.map((row) => row.map(parseNum)) : undefined,
      },
      // Đồng bộ thang điểm cũ để chỗ khác (chia sẻ / danh sách) vẫn đọc được.
      pointLadder: maxes.join(","),
    });
    setMessage("Đã lưu thiết lập điểm");
    setTimeout(() => setMessage(null), 2500);
  };

  const reset = () => {
    load();
    setMessage(null);
  };

  return (
    <details className="card mb-4 p-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Thiết lập điểm</h2>
          <p className="text-xs text-slate-500">
            {parts.map((p) => `${PART_LABELS[p.pi] ?? p.label} ${fmt(totalOf(p.pi))}`).join(" · ")} — tổng{" "}
            <b>{fmt(grand)}</b> điểm · bấm để chỉnh số câu / điểm 1 câu
          </p>
        </div>
        <span className="text-xs text-brand-700">▾ Mở</span>
      </summary>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost px-2 py-1 text-xs" onClick={reset}>
          ↺ Khôi phục
        </button>
        <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => void save()}>
          Lưu thiết lập
        </button>
      </div>

      {message && <p className="mb-2 rounded bg-green-50 px-3 py-1.5 text-sm text-green-700">{message}</p>}

      <div className="space-y-3">
        {parts.map((part) => {
          const i = part.pi;
          const total = totalOf(i);
          return (
            <div key={`${part.label}-${i}`} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
                  {PART_LABELS[i] ?? part.label}
                </span>
                <span className="text-xs text-slate-500">
                  {part.kind === "p2" ? "mỗi câu 4 ý" : part.kind === "p3" ? "mỗi câu 4 số" : ""}
                </span>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">Số lượng câu</span>
                  <input
                    className="input w-20 py-1 text-center text-sm"
                    inputMode="numeric"
                    value={counts[i] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCounts((prev) => {
                        const next = [...prev];
                        next[i] = value;
                        return next;
                      });
                      // PHẦN II: số dòng phải khớp số câu — thêm dòng mới bằng
                      // thang mặc định, bớt thì cắt đuôi (giữ các dòng đã sửa).
                      if (part.kind === "p2") {
                        const want = Math.max(0, Math.round(parseNum(value)));
                        setP2Rows((prev) =>
                          Array.from({ length: want }, (_, c) =>
                            prev[c] ? [...prev[c]] : defaultP2Row(),
                          ),
                        );
                      }
                    }}
                  />
                </label>
                {part.kind === "p2" ? (
                  // PHẦN II: tổng điểm cộng từ mức "4 ý" của từng dòng bên
                  // dưới, nên ở đây chỉ hiện số câu và tổng — không có ô
                  // "điểm 1 câu" để nhập (mỗi dòng tự có 4 mức riêng).
                  <>
                    <span className="pb-1.5 text-slate-400">=</span>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">Tổng điểm</span>
                      <span className="input flex w-24 items-center justify-center bg-slate-50 py-1 text-center text-sm font-semibold text-slate-700">
                        {fmt(total)}
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <span className="pb-1.5 text-slate-400">×</span>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">Điểm 1 câu</span>
                      <input
                        className="input w-24 py-1 text-center text-sm"
                        inputMode="decimal"
                        value={perQ[i] ?? ""}
                        onChange={(e) =>
                          setPerQ((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                      />
                    </label>
                    <span className="pb-1.5 text-slate-400">=</span>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-500">Tổng điểm</span>
                      <span className="input flex w-24 items-center justify-center bg-slate-50 py-1 text-center text-sm font-semibold text-slate-700">
                        {fmt(total)}
                      </span>
                    </label>
                  </>
                )}
              </div>

              {part.kind === "p2" && (
                /*
                 * Mỗi câu PHẦN II là MỘT DÒNG: 4 ô = điểm khi trúng 1/2/3/4 ý
                 * của câu đó. Số dòng theo "Số lượng câu" ở trên; số thứ tự ô
                 * đáp án bắt đầu từ câu 41 và tăng 4 mỗi dòng (41–44, 45–48…).
                 */
                <div className="mt-2 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="w-[4.5rem] shrink-0">Câu</span>
                    <span className="w-[5.5rem] shrink-0">Ô đáp án</span>
                    {[1, 2, 3, 4].map((n) => (
                      <span key={n} className="w-[4.5rem] text-center">
                        Trúng {n} ý
                      </span>
                    ))}
                  </div>
                  {Array.from({ length: Math.max(0, Math.round(parseNum(counts[i] ?? "0"))) }, (_, c) => {
                    const firstNo = p2FirstNumber + c * 4;
                    return (
                      <div key={c} className="flex flex-wrap items-center gap-2">
                        <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-slate-600">
                          Câu {c + 1}
                        </span>
                        <span className="w-[5.5rem] shrink-0 font-mono text-[11px] text-slate-400">
                          {firstNo}–{firstNo + 3}
                        </span>
                        {[0, 1, 2, 3].map((k) => (
                          <input
                            key={k}
                            className="input w-[4.5rem] py-1 text-center text-sm"
                            inputMode="decimal"
                            value={p2Rows[c]?.[k] ?? ""}
                            onChange={(e) =>
                              setP2Rows((prev) => {
                                const next = Array.from({ length: Math.max(prev.length, c + 1) }, (_, idx) => [
                                  ...(prev[idx] ?? ["0", "0", "0", "0"]),
                                ]);
                                next[c][k] = e.target.value;
                                return next;
                              })
                            }
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="mt-1 text-[11px] text-slate-400">
                {part.kind === "p2"
                  ? "Bốn mức là thang luỹ tiến theo số ý đúng: trúng 1 ý / 2 ý / 3 ý / 4 ý. Tổng điểm = cộng mức “4 ý” của từng dòng, tự cập nhật khi sửa số câu hoặc mức điểm."
                  : "Tổng điểm = số lượng câu × điểm 1 câu, tự cập nhật khi sửa một trong hai ô."}
              </p>
            </div>
          );
        })}
      </div>
    </details>
  );
}
