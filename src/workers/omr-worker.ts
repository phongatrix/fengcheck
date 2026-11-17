/**
 * OMR Web Worker — marker detection, perspective warp, bubble reading,
 * grading and annotation all run here so the UI thread stays smooth.
 *
 * Protocol (main → worker):
 *   { kind: "probe",   id, width, height, buf, checkSharpness }
 *       → light pass: 4-corner detection only (cached frame kept for "process").
 *   { kind: "process", id, width?, height?, buf?, useLast?, form, grade, checkSharpness }
 *       → full pass on the cached probe frame (useLast) or a fresh buffer
 *         (uploads). Returns answers, score and the annotated RGBA preview.
 *
 * All ArrayBuffers are transferred, never copied.
 */

/// <reference lib="webworker" />

import type { FormConfig, GrayMat, Pt, ReadQuestion, SheetLayout } from "@/lib/omr/types";
import { fromRgba, resizeMat } from "@/lib/omr/matrix";
import { probeGray, processGray, renderScoredPreview } from "@/lib/omr/pipeline";
import { processWithFormDetection, matchKeyByCode, type FormDetectResult } from "@/lib/omr/form-detect";
import { processGrayWithCrop } from "@/lib/omr/pipeline";
import { straightenRgbaByMarkers } from "@/lib/omr/sheet-crop";
import { gradeAnswers, gradeGiay, parsePartMaxes } from "@/lib/scoring";
import { cellWeightsFor } from "@/lib/points";
import { GIAY_FORMS, type FormKind } from "@/lib/omr/types";
import { answersFromSections, sectionsFromAnswers, normalizeKeyLegacy } from "@/lib/omr/key-sections";
import { layoutSignCauCount } from "@/lib/omr/giay-layouts";
import { inferCodeFromAnswers } from "@/lib/omr/code-infer";

export interface WorkerGradeOptions {
  isSplit?: boolean;
  parts?: { maxScore: number; count: number }[] | null;
  maxScore?: number;
  /** "p1,p2,p3" part maxes for the Giấy 12 / Giấy 10-11 forms. */
  ladder?: string;
  /** Điểm/trọng số riêng từng câu (không gian câu: P1 1..N, P2 1..M, P3 1..K). */
  perCau?: number[] | null;
  /** Điểm từng ý a–d của PHẦN II (thang luỹ tiến, dùng chung mọi câu). */
  p2Sub?: number[] | null;
  /** Điểm từng ý RIÊNG từng câu PHẦN II — mỗi dòng một mảng 4 số. */
  p2Row?: number[][] | null;
  /** Số câu mỗi phần của FORM ĐÃ NHẬP ĐIỂM (để tra đúng câu khi phiếu khác mẫu). */
  cauCounts?: { p1: number; p2: number; p3: number } | null;
}

/** Per-part câu counts of the two printed templates. */
function giayCounts(kind: FormKind, layout: SheetLayout) {
  return {
    p1: layout.part1Count,
    p2: Math.floor(layout.part2Count / 4),
    p3: layout.part3.length,
  };
}

type ProbeRequest = {
  kind: "probe";
  id: number;
  width: number;
  height: number;
  buf: ArrayBuffer;
  checkSharpness: boolean;
};

type ProcessRequest = {
  kind: "process";
  id: number;
  width?: number;
  height?: number;
  buf?: ArrayBuffer;
  useLast?: boolean;
  form: FormConfig;
  grade?: WorkerGradeOptions | null;
  /** All answer keys of the active quiz, matched by the scanned exam code. */
  keys?: { code: string; answers: number[] }[] | null;
  checkSharpness: boolean;
  /**
   * ẢNH UPLOAD: cắt theo KHUNG ĐỎ của mẫu (mẫu có `cropBox`, vd Giấy 10-11)
   * sau khi xoay thẳng theo 4 mốc in / đường kẻ. Ảnh webcam không bật.
   */
  cropToBox?: boolean;
};

export type OmrRequest = ProbeRequest | ProcessRequest;

export interface ProbeResponse {
  kind: "probe";
  id: number;
  ok: boolean;
  stage: "searching" | "low-sharpness" | "no-markers" | "aligned";
  message?: string;
  quad?: [Pt, Pt, Pt, Pt];
  sharpness: number;
  width: number;
  height: number;
}

export interface ProcessResponse {
  kind: "process";
  id: number;
  ok: boolean;
  error?: string;
  quad?: [Pt, Pt, Pt, Pt];
  sharpness?: number;
  answers?: number[];
  questions?: Pick<ReadQuestion, "index" | "answer" | "unsure">[];
  /** PHẦN III digits: per numeric câu, per column (0..9, -1 blank). */
  part3?: number[][];
  examCode?: string | null;
  studentCode?: string | null;
  readError?: boolean;
  /** True when an answer key matched the scanned exam code. */
  keyFound?: boolean;
  /** Số câu ĐÁP ÁN CÓ mà đọc không chắc (bỏ trống / tô đè) — dùng cho cảnh báo. */
  keyUnsure?: number;
  /** Số câu (đáp án CÓ) học sinh TÔ NHIỀU Ô trong cùng một ý (answer = -2). */
  keyMulti?: number;
  /** Danh sách số câu tô nhiều (1-based, theo không gian câu của layout đọc). */
  keyMultiList?: number[];
  /** The 3-digit code of the matched key. */
  matchedCode?: string | null;
  /** Mẫu giấy thực sự đã dùng để đọc (tự nhận diện) + có đổi so với khai báo không. */
  formUsed?: FormKind;
  formSwitched?: boolean;
  /** Mã đề SUY NGƯỢC từ lưới đáp án (ô mã đề không đọc được / đọc nhầm). */
  codeInferred?: boolean;
  /** Tỉ lệ khớp ô đáp án của mã suy ngược (0..1). */
  codeMatchRatio?: number;
  /** Score lines like "8/10=8.00" when a key was provided. */
  scoreText?: string | null;
  scoreLines?: string[];
  /** Annotated RGBA preview, transferred. */
  preview?: { width: number; height: number; buf: ArrayBuffer };
  layout?: Pick<SheetLayout, "width" | "height"> & { kind?: FormKind };
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
let lastGray: (GrayMat & { buf: ArrayBuffer; scale: number }) | null = null;

/**Ảnh nhỏ (upload crop, preview nhỏ) — phóng to để dò marker/đọc bubble ổn định. */
function maybeUpscale(gray: GrayMat): { gray: GrayMat; scale: number } {
  const maxSide = Math.max(gray.width, gray.height);
  if (maxSide >= 700) return { gray, scale: 1 };
  const scale = Math.min(3, Math.ceil(900 / maxSide));
  return { gray: resizeMat(gray, gray.width * scale, gray.height * scale), scale };
}

function handleProbe(req: ProbeRequest): void {
  const raw = fromRgba(req.buf, req.width, req.height);
  const { gray, scale } = maybeUpscale(raw);
  // Keep the frame around so the follow-up "process" can reuse it.
  lastGray = { ...gray, buf: req.buf, scale };
  const res = probeGray(gray, { checkSharpness: req.checkSharpness });
  const inv = 1 / scale;
  if (res.quad) res.quad = res.quad.map((p) => ({ x: p.x * inv, y: p.y * inv })) as typeof res.quad;
  const resp: ProbeResponse = {
    kind: "probe",
    id: req.id,
    ok: res.ok,
    stage: res.stage,
    message: res.message,
    quad: res.quad,
    sharpness: res.sharpness,
    width: req.width,
    height: req.height,
  };
  worker.postMessage(resp);
}

function handleProcess(req: ProcessRequest): void {
  let gray: GrayMat | null = null;
  if (req.useLast) {
    gray = lastGray;
  } else if (req.buf && req.width && req.height) {
    gray = fromRgba(req.buf, req.width, req.height);
  }
  if (!gray) {
    const resp: ProcessResponse = { kind: "process", id: req.id, ok: false, error: "Không có khung hình để xử lý" };
    worker.postMessage(resp);
    return;
  }

  const up = maybeUpscale(gray);
  // Tự nhận diện MẪU GIẤY của ảnh (4 mẫu dùng chung): mẫu khai báo đọc tốt thì
  // giữ nguyên (chỉ 1 lần đọc); đọc kém thì thử các mẫu còn lại và lấy mẫu có
  // độ khớp vành ô in × tỉ lệ ô đọc tốt nhất. Nhờ vậy ảnh Giấy 12 / Mới 2025
  // upload vào bài thi QM_A4 vẫn được đọc đúng — lưới đáp án khớp hình upload.
  // Nhánh crop trả thêm `sheetQuad` (4 mốc trên ảnh đã cân bằng sáng) để worker
  // xoay thẳng preview; nhánh thường không có (optional).
  const detected: FormDetectResult & { sheetQuad?: [Pt, Pt, Pt, Pt] } =
    req.cropToBox === true
      ? processGrayWithCrop(up.gray, {
          form: req.form,
          checkSharpness: req.checkSharpness,
          keys: req.keys,
          cropToBox: true,
        })
      : processWithFormDetection(up.gray, req.form, {
          checkSharpness: req.checkSharpness,
          keys: req.keys,
        });
  const res = detected;

  const base: ProcessResponse = {
    kind: "process",
    id: req.id,
    ok: res.ok,
    error: res.error,
    quad:
      res.markers && res.markers.length === 4
        ? (res.markers.map((p) => ({ x: p.x / up.scale, y: p.y / up.scale })) as [Pt, Pt, Pt, Pt])
        : undefined,
    sharpness: res.sharpness,
    answers: res.answers,
    questions: res.questions?.map((q) => ({ index: q.index, answer: q.answer, unsure: q.unsure, scores: q.scores })),
    part3: res.part3,
    examCode: res.examCode,
    studentCode: res.studentCode,
    readError: res.readError,
    layout: { width: res.layout.width, height: res.layout.height, kind: res.layout.kind },
    formUsed: detected.formUsed,
    formSwitched: detected.formSwitched,
  };

  if (res.ok && res.questions) {
    // Match the answer key exactly like the original detector: by the scanned
    // exam code, or the quiz's single key when the sheet has no code block.
    // matchKeyByCode: ưu tiên mã đọc được nguyên văn (3 HOẶC 4 số — biến thể
    // Giấy 12 tô đủ 4 cột "2109"), sau đó đuôi 3 số (1132 ↔ 132).
    const rawCode = res.examCode?.trim() ?? "";
    let matched = matchKeyByCode(rawCode, req.keys);
    if (!matched && req.keys?.length === 1 && !res.layout.examCode) {
      // Chỉ khi mẫu KHÔNG in lưới mã đề (bài một mã đề). Mẫu có lưới mã đề mà
      // đọc hỏng thì KHÔNG được gán bừa — phiếu của mã khác sẽ bị chấm oan.
      matched = req.keys[0];
    }
    // Không khớp mã (ô mã đề mờ / đọc nhầm chữ số): suy ngược từ LƯỚI ĐÁP ÁN —
    // mã nào khớp >80% số ô đáp án có đáp án thì nhận (học sinh làm đúng gần
    // hết bài theo mã đó). Không bao giờ suy khi đã khớp được bằng mã.
    let inferred: { code: string; ratio: number } | null = null;
    if (!matched && req.keys?.length) {
      const g = inferCodeFromAnswers(
        res.answers ?? [],
        res.layout,
        req.keys,
        req.form.form as FormKind,
        req.form.ansNumber,
      );
      if (g) {
        inferred = { code: g.code, ratio: g.ratio };
        matched = req.keys.find((k) => k.code === g.code);
      }
    }
    base.keyFound = !!matched;
    base.matchedCode = matched?.code ?? null;
    if (inferred) {
      base.codeInferred = true;
      base.codeMatchRatio = inferred.ratio;
    }

    // Grade in here so the preview comes back fully annotated in one hop.
    let scoreText: string | null = null;
    let scoreLines: string[] = [];
    // Đáp án lưu theo form của bài thi; phiếu có thể là mẫu còn lại (2 mẫu
    // dùng chung) → quy đáp án về đúng layout vừa đọc.
    const layoutKind = (res.layout.kind ?? req.form.form) as FormKind;
    if (matched && layoutKind !== req.form.form) {
      const sections = sectionsFromAnswers(matched.answers, req.form.form as FormKind, req.form.ansNumber);
      matched = { code: matched.code, answers: answersFromSections(sections, res.layout) };
    } else if (matched) {
      // Key nhập TRƯỚC khi có ô dấu PHẦN III: chuẩn hoá về encoding hiện hành
      // (dấu chấm đang chiếm một ô chữ số → dồn chữ số + ghi ô dấu phẩy;
      // vector thiếu ô dấu thì điền thêm -1) trước khi chấm.
      matched = { code: matched.code, answers: normalizeKeyLegacy(matched.answers, res.layout) };
    }
    if (matched) {
      // Điểm từng câu: trải trọng số theo ô của layout VỪA ĐỌC (hai mẫu dùng
      // chung khác số câu mỗi phần — tra theo không gian câu của form đã nhập).
      const srcCau = req.grade?.cauCounts ?? null;
      const dstCau = giayCounts(layoutKind, res.layout);
      // Số câu ĐỂ CHẤM: người dùng đặt trong Thiết lập điểm (partCount) có thể
      // nhỏ hơn số ô in của mẫu — đề 24 câu in trên phiếu 40 ô thì chỉ chấm 24
      // câu (16 ô còn lại là câu không dùng, không được tính là sai). Chỉ áp
      // khi bài thi và phiếu CÙNG mẫu: khác mẫu thì đáp án đã được quy đổi sang
      // layout vừa đọc và số câu phải theo layout đó.
      const sameForm = layoutKind === req.form.form;
      const gradeCau = sameForm && srcCau
        ? {
            p1: Math.min(srcCau.p1, dstCau.p1),
            p2: Math.min(srcCau.p2, dstCau.p2),
            p3: Math.min(srcCau.p3, dstCau.p3),
          }
        : dstCau;
      const perCau = req.grade?.perCau;
      // Ô dấu PHẦN III chỉ chấm trong số câu thực chấm (partCount) của layout.
      const signCau = Math.min(layoutSignCauCount(res.layout), gradeCau.p3);
      // Độ dài vector theo số ô IN (dstCau), chỉ số câu được chấm theo gradeCau.
      const cellWeights =
        perCau && perCau.length > 0 && srcCau ? cellWeightsFor(perCau, srcCau, dstCau, signCau, gradeCau) : null;
      // PHẦN II: điểm từng ý a–d được ưu tiên hơn trọng số từng câu — nó là thứ
      // người dùng nhập trong Thiết lập điểm (Điểm 1 ý … Điểm 4 ý).
      // PHẦN II: p2Row (điểm riêng từng dòng) ưu tiên; p2Sub là thang dùng
      // chung. Cả hai chỉ ảnh hưởng PHẦN II nên KHÔNG truyền vào `weights`.
      const p2Row = req.grade?.p2Row ?? null;
      const p2Sub = req.grade?.p2Sub ?? null;
      if (GIAY_FORMS.includes(layoutKind)) {
        const counts = gradeCau;
        const result = gradeGiay(counts, matched.answers, res.answers ?? [], parsePartMaxes(req.grade?.ladder), {
          weights: cellWeights,
          p2Row,
          p2Sub,
          p3SignCau: signCau,
          printed: dstCau,
          // Phiếu đọc ít câu Đ/S hơn lúc nhập điểm → chuẩn hoá thang P2 để bài
          // đủ điểm vẫn bằng điểm tối đa của phần (giống thang mặc định).
          p2TopSum: gradeCau.p2 < dstCau.p2 ? parsePartMaxes(req.grade?.ladder).p2 : null,
        });
        scoreText = result.text;
        scoreLines = result.lines;
      } else if (req.grade) {
        const result = gradeAnswers(matched.answers, res.answers ?? [], {
          isSplit: req.grade.isSplit,
          parts: req.grade.parts ?? null,
          maxScore: req.grade.maxScore,
          weights: cellWeights,
        });
        scoreText = result.text;
        scoreLines = result.parts.map((p) => p.text);
      }
    }
    // Chỉ cảnh báo những câu đáp án THỰC SỰ có: đề dùng 18/40 ô thì 22 ô
    // trống còn lại không phải lỗi đọc.
    if (matched) {
      const keyForQuestions = matched.answers;
      let unsure = 0;
      /**
       * TÔ NHIỀU Ô (yêu cầu 2026-11-17): câu đáp án CÓ mà bộ đọc trả -2
       * (multi — PHẦN I 2+ phương án, PHẦN II cả Đ và S) là lỗi của HỌC SINH,
       * không phải "đọc không chắc" — đếm riêng để UI báo đúng câu nào.
       */
      const multi: number[] = [];
      res.questions.forEach((q) => {
        const k = keyForQuestions[q.index];
        if (k === undefined || k < 0) return;
        if (q.answer === -2) multi.push(q.index + 1);
        else if (q.unsure) unsure++;
      });
      base.keyUnsure = unsure;
      base.keyMulti = multi.length;
      base.keyMultiList = multi;
    }

    base.scoreText = scoreText;
    base.scoreLines = scoreLines;

    if (res.canonical) {
      /**
       * KHÔNG chèn thêm dòng "SBD: …" / "Ma de: …" lên đầu khối chữ đỏ: mẫu
       * kết quả chốt 2026-11-16 chỉ có P1 / P2 / P3 / Tong trong khung điểm,
       * còn SBD và mã đề đã hiện ở ô "Phách" và trên phiếu (HS tô). Chèn thêm
       * làm khối chữ đỏ cao gấp đôi và đè lên nhãn in sẵn ("Viết bằng số",
       * "Giám khảo 1") — đo trên ảnh mẫu: khối đỏ chỉ 3 dòng, ink 1.50%H.
       */
      const rgba = renderScoredPreview(res, scoreText, matched?.answers ?? null);
      if (rgba) {
        // XOAY THẲNG + CẮT preview theo khung đỏ của mẫu (mẫu có cropBox, vd
        // Giấy 10-11): warp RGBA theo 4 mốc trên ảnh nguồn → hình chữ nhật
        // thẳng đúng vùng đáp án, không lẫn nền bàn. Tỉ lệ khung = cropBox của
        // layout (toạ độ chuẩn hoá 0..1 × tỉ lệ trang); không có cropBox thì
        // dùng tỉ lệ trang.
        let finalData = rgba.rgba;
        let fw = rgba.width;
        let fh = rgba.height;
        const flat = res.source;
        if (req.cropToBox === true && res.sheetQuad && flat) {
          const lay = res.layout;
          // Tỉ lệ ĐÚNG của ảnh ra = tỉ lệ 4 mốc của mẫu (mốc in thật trên phiếu),
          // không phải tỉ lệ trang — warp mốc → hình chữ nhật sẽ méo nếu dùng sai.
          const mk = lay.markers;
          const aspect = mk
            ? ((mk.bl.y - mk.tl.y) * lay.height) / ((mk.tr.x - mk.tl.x) * lay.width)
            : lay.height / lay.width;
          const straightened = straightenRgbaByMarkers(
            { width: rgba.width, height: rgba.height, data: rgba.rgba },
            flat,
            res.sheetQuad,
            1500,
            aspect,
          );
          if (straightened) {
            fw = straightened.width;
            fh = straightened.height;
            finalData = straightened.data;
          }
        }
        base.preview = { width: fw, height: fh, buf: finalData.buffer as ArrayBuffer };
      }
    }
  }

  worker.postMessage(base, base.preview ? [base.preview.buf] : []);
}

worker.onmessage = (ev: MessageEvent<OmrRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === "probe") handleProbe(req);
    else handleProcess(req);
  } catch (err) {
    const resp: ProcessResponse = {
      kind: "process",
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : "Lỗi xử lý ảnh",
    };
    worker.postMessage(resp);
  }
};
