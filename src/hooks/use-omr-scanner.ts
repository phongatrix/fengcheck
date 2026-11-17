"use client";

/**
 * Webcam scanner hook driving the OMR worker.
 *
 * Mirrors the Android detector loop (rr/Der):
 *  - grab frame → worker probe (4-corner detect) at ~4-5 fps,
 *  - stable aligned frames + sharpness gate → full process (warp → read → grade),
 *  - cooldown after each scan so one sheet isn't captured twice,
 *  - upload path runs the same pipeline with the sharpness gate disabled.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormConfig, Pt } from "@/lib/omr/types";
import type { ProcessResponse, ProbeResponse, WorkerGradeOptions } from "@/workers/omr-worker";
import { beepError, beepSuccess, beepTick } from "@/lib/sound";

export type ScanStage =
  | "idle"
  | "starting"
  | "searching"
  | "low-sharpness"
  | "no-markers"
  | "aligned"
  | "processing"
  | "result"
  | "error";

export interface ScanPreview {
  width: number;
  height: number;
  url: string;
  blob: Blob;
}

export interface ScanResult {
  id: number;
  answers: number[];
  questions: { index: number; answer: number; unsure: boolean }[];
  examCode?: string | null;
  studentCode?: string | null;
  readError: boolean;
  keyFound: boolean;
  /** Câu thuộc đáp án nhưng đọc không chắc (bỏ trống / tô đè). */
  keyUnsure?: number;
  /** Số câu học sinh TÔ NHIỀU Ô trong cùng một ý (không được điểm ý đó). */
  keyMulti?: number;
  /** Số câu (1-based) tô nhiều đáp án — để UI liệt kê chính xác. */
  keyMultiList?: number[];
  matchedCode?: string | null;
  /** Mẫu giấy thực tế của ảnh (tự nhận diện) + có khác mẫu khai báo không. */
  formUsed?: string;
  formSwitched?: boolean;
  /** Mẫu giấy mà vector `answers` thực sự thuộc về (layout vừa đọc). */
  layoutKind?: string;
  /** Mã đề suy ngược từ lưới đáp án (ô mã đề mờ) + tỉ lệ khớp. */
  codeInferred?: boolean;
  codeMatchRatio?: number;
  scoreText?: string | null;
  scoreLines: string[];
  preview?: ScanPreview;
  sharpness?: number;
  source: "camera" | "upload";
}

export interface ScannerOptions {
  form: FormConfig;
  /** All answer keys of the active quiz — the worker matches by exam code. */
  keys?: { code: string; answers: number[] }[] | null;
  grade?: WorkerGradeOptions | null;
  autoScan?: boolean;
  cooldownMs?: number;
  sound?: boolean;
}

export interface FrameInfo {
  width: number;
  height: number;
}

const PROBE_INTERVAL_MS = 220;
const STABLE_FRAMES = 2;
const MAX_FRAME_SIDE = 1280;

export function useOmrScanner(opts: ScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const grabCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastProbeRef = useRef(0);
  const alignedStreakRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const reqIdRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Latest state accessed from worker callbacks (refs avoid stale closures).
  const pausedRef = useRef(false);
  const processingRef = useRef(false);
  const resultRef = useRef<ScanResult | null>(null);
  const uploadSourceRef = useRef(false);
  const frameSizeRef = useRef<FrameInfo>({ width: 0, height: 0 });
  // Indirection so the worker callback and the process sender can reference
  // each other without a hook-dependency cycle.
  const sendProcessRef = useRef<(useLast: boolean, buf?: ArrayBuffer, w?: number, h?: number) => void>(
    () => {},
  );
  const onProcessRef = useRef<(msg: ProcessResponse) => void>(() => {});
  /** Callbacks chờ kết quả process theo id — dùng cho chế độ chấm hàng loạt. */
  const pendingRef = useRef(new Map<number, (msg: ProcessResponse) => void>());
  const msgIdRef = useRef(10_000); // dải riêng để không đụng reqId của camera
  /**
   * Đang chấm hàng loạt: kết quả KHÔNG được đẩy lên thẻ kết quả camera và
   * preview không ghi vào previewUrlRef (mỗi ảnh tự quản lý URL của nó).
   */
  const batchModeRef = useRef(false);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stage, setStage] = useState<ScanStage>("idle");
  const [status, setStatus] = useState("Camera đang tắt");
  const [frame, setFrame] = useState<FrameInfo>({ width: 0, height: 0 });
  const [quad, setQuad] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  const [sharpness, setSharpness] = useState<number | undefined>(undefined);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [paused, setPaused] = useState(false);

  pausedRef.current = paused;
  processingRef.current = processing;
  resultRef.current = result;

  const play = useCallback((fn: () => void) => {
    if (optsRef.current.sound !== false) fn();
  }, []);

  /** Raw RGBA (from the worker) → PNG blob + object URL. */
  const rgbaToPng = useCallback(
    (rgba: { width: number; height: number; buf: ArrayBuffer }): Promise<ScanPreview | null> =>
      new Promise((resolve) => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = rgba.width;
          canvas.height = rgba.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buf), rgba.width, rgba.height), 0, 0);
          canvas.toBlob((blob) => {
            if (!blob) return resolve(null);
            const url = URL.createObjectURL(blob);
            resolve({ width: rgba.width, height: rgba.height, url, blob });
          }, "image/png");
        } catch {
          resolve(null);
        }
      }),
    [],
  );

  /** Lazily create the singleton OMR worker (main → worker bridge). */
  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("../workers/omr-worker.ts", import.meta.url));
    /**
     * Worker chết (lỗi biên dịch, hết bộ nhớ, chunk không tải được) trước đây
     * không ai bắt: promise trong `processFile`/`sendProcess` không bao giờ
     * settle nên giao diện treo ở "Đang xử lý..." và nút batch chạy mãi.
     * Chuyển lỗi thành reject cho MỌI request đang chờ, rồi bỏ worker để lần
     * sau tạo lại từ đầu.
     */
    /** Báo lỗi cho mọi request đang chờ rồi bỏ worker để lần sau tạo lại. */
    const failPending = (message: string) => {
      const waiting = [...pendingRef.current.values()];
      pendingRef.current.clear();
      for (const cb of waiting) cb({ kind: "process", id: -1, ok: false, error: message } as ProcessResponse);
      workerRef.current = null;
      processingRef.current = false;
      setProcessing(false);
      setStage("error");
      setStatus(message);
    };
    worker.onerror = (ev: ErrorEvent) => failPending(ev.message || "Worker đọc phiếu gặp lỗi");
    worker.onmessageerror = () => failPending("Dữ liệu worker không đọc được");
    worker.onmessage = (ev: MessageEvent<ProcessResponse | ProbeResponse>) => {
      const msg = ev.data;
      if (msg.kind === "probe") {
        setSharpness(msg.sharpness);
        if (pausedRef.current || resultRef.current || processingRef.current) return;
        if (msg.ok && msg.quad) {
          setQuad(msg.quad);
          alignedStreakRef.current += 1;
          setStage("aligned");
          setStatus("Đủ 4 góc — giữ yên phiếu");
          if (alignedStreakRef.current === STABLE_FRAMES - 1) play(beepTick);
          const o = optsRef.current;
          if (
            o.autoScan !== false &&
            !batchModeRef.current && // đang chấm hàng loạt: không tự chụp
            alignedStreakRef.current >= STABLE_FRAMES &&
            Date.now() >= cooldownUntilRef.current
          ) {
            alignedStreakRef.current = 0;
            sendProcessRef.current(true);
          }
        } else {
          alignedStreakRef.current = 0;
          setQuad(null);
          if (msg.stage === "low-sharpness") {
            setStage("low-sharpness");
            setStatus(msg.message ?? "Ảnh mờ — giữ máy chắc và lấy nét lại");
          } else {
            setStage("no-markers");
            setStatus(msg.message ?? "Đang tìm marker... Đưa phiếu vào khung hình");
          }
        }
      } else {
        const pending = pendingRef.current.get(msg.id);
        if (pending) {
          pendingRef.current.delete(msg.id);
          pending(msg);
          return;
        }
        onProcessRef.current(msg);
      }
    };
    workerRef.current = worker;
    return worker;
  }, [play]);

  const sendProcess = useCallback(
    (
      useLast: boolean,
      buf?: ArrayBuffer,
      width?: number,
      height?: number,
      checkSharpness = useLast,
      cropToBox = false,
    ) => {
      const worker = ensureWorker();
      const o = optsRef.current;
      processingRef.current = true;
      setProcessing(true);
      setStage("processing");
      setStatus("Đang xử lý...");
      reqIdRef.current += 1;
      const transfer: ArrayBuffer[] = buf ? [buf] : [];
      worker.postMessage(
        {
          kind: "process",
          id: reqIdRef.current,
          useLast,
          width,
          height,
          buf,
          form: o.form,
          keys: o.keys ?? null,
          grade: o.grade ?? null,
          // Ảnh chụp từ camera vẫn giữ cổng nét; ảnh tải lên thì tắt (ảnh cũ
          // thường hơi mờ nhưng vẫn đọc được).
          checkSharpness,
          // Upload: cắt theo KHUNG ĐỎ của mẫu (Giấy 10-11) + xoay thẳng theo
          // 4 mốc in / đường kẻ trước khi chấm. Camera không bật (khung đã canh).
          cropToBox,
        },
        transfer,
      );
    },
    [ensureWorker],
  );

  /** Convert a worker response into a ScanResult (no UI side effects). */
  const mapProcessResponse = useCallback(
    async (msg: ProcessResponse): Promise<ScanResult> => {
      if (!msg.ok) {
        throw new Error(msg.error ?? "Không đọc được phiếu");
      }
      const preview = msg.preview ? await rgbaToPng(msg.preview) : undefined;
      // Ảnh preview của lượt chấm hàng loạt không phải ảnh đang hiện trên thẻ
      // kết quả → không được ghi đè previewUrlRef (huỷ nhầm ảnh đang xem) và
      // phải tự thu hồi URL của chính nó sau khi dùng xong.
      if (preview && !batchModeRef.current && previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (preview && !batchModeRef.current) previewUrlRef.current = preview.url;
      const scan: ScanResult = {
        id: msg.id,
        answers: msg.answers ?? [],
        questions: msg.questions ?? [],
        examCode: msg.examCode,
        studentCode: msg.studentCode,
        readError: !!msg.readError,
        keyFound: !!msg.keyFound,
        keyUnsure: msg.keyUnsure ?? 0,
        keyMulti: msg.keyMulti ?? 0,
        keyMultiList: msg.keyMultiList ?? [],
        matchedCode: msg.matchedCode ?? null,
        formUsed: msg.formUsed,
        formSwitched: msg.formSwitched ?? false,
        layoutKind: msg.layout?.kind,
        codeInferred: msg.codeInferred ?? false,
        codeMatchRatio: msg.codeMatchRatio,
        scoreText: msg.scoreText ?? null,
        scoreLines: msg.scoreLines ?? [],
        preview: preview ?? undefined,
        sharpness: msg.sharpness,
        source: batchModeRef.current ? "upload" : uploadSourceRef.current ? "upload" : "camera",
      };
      uploadSourceRef.current = false;
      return scan;
    },
    [rgbaToPng],
  );

  const handleProcessResponse = useCallback(
    async (msg: ProcessResponse) => {
      processingRef.current = false;
      setProcessing(false);

      if (!msg.ok) {
        uploadSourceRef.current = false;
        play(beepError);
        setStage("no-markers");
        setStatus(msg.error ?? "Không đọc được phiếu");
        cooldownUntilRef.current = Date.now() + 800;
        return;
      }

      const scan = await mapProcessResponse(msg);

      const hasHardError = scan.readError || scan.answers.some((a) => a === -2);
      if (hasHardError) play(beepError);
      else play(beepSuccess);

      pausedRef.current = true;
      setPaused(true);
      setResult(scan);
      setStage("result");
      setStatus(
        hasHardError ? "Đọc không chắc (-4/-2) — kiểm tra lại hoặc chụp lại" : "Đọc phiếu thành công",
      );
    },
    [play, mapProcessResponse],
  );

  // Point the indirection refs at the latest closures.
  sendProcessRef.current = sendProcess;
  onProcessRef.current = (msg) => void handleProcessResponse(msg);

  /**
   * Xử lý một file ảnh qua worker và trả về kết quả chấm (không set UI state).
   * Dùng cho chế độ upload nhiều ảnh (batch): gọi ở ngoài hook, tự quản lý danh sách.
   */
  const processFile = useCallback(
    async (file: File): Promise<ScanResult> => {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas không sẵn sàng");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      bitmap.close();

      setProcessing(true);
      try {
        batchModeRef.current = true;
        const scan = await new Promise<ScanResult>((resolve, reject) => {
          const worker = ensureWorker();
          msgIdRef.current += 1;
          const id = msgIdRef.current;
          // Lưới an toàn: worker kẹt (ảnh quá lớn, vòng lặp vô hạn) thì phải báo
          // lỗi cho người dùng thay vì treo cả lượt chấm hàng loạt.
          const timer = setTimeout(() => {
            if (!pendingRef.current.has(id)) return;
            pendingRef.current.delete(id);
            reject(new Error("Đọc phiếu quá lâu — thử lại hoặc chụp lại ảnh"));
          }, 60_000);
          pendingRef.current.set(id, (msg: ProcessResponse) => {
            clearTimeout(timer);
            if (!msg.ok) {
              reject(new Error(msg.error ?? "Không đọc được phiếu"));
              return;
            }
            resolve(mapProcessResponse(msg));
          });
          const transfer: ArrayBuffer[] = [imageData.data.buffer];
          worker.postMessage(
            {
              kind: "process",
              id,
              useLast: false,
              width: canvas.width,
              height: canvas.height,
              buf: imageData.data.buffer,
              form: optsRef.current.form,
              keys: optsRef.current.keys ?? null,
              grade: optsRef.current.grade ?? null,
              checkSharpness: false,
              // Chấm hàng loạt = ảnh tải lên → cắt theo khung đỏ của mẫu.
              cropToBox: true,
            },
            transfer,
          );
        });
        uploadSourceRef.current = false;
        return scan;
      } finally {
        batchModeRef.current = false;
        setProcessing(false);
      }
    },
    [ensureWorker, mapProcessResponse],
  );

  /** Grab a video frame into an RGBA buffer (transferred to the worker). */
  const grabFrame = useCallback((): { buf: ArrayBuffer; width: number; height: number } | null => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
      return null;
    }
    if (!grabCanvasRef.current) grabCanvasRef.current = document.createElement("canvas");
    const canvas = grabCanvasRef.current;
    const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    if (frameSizeRef.current.width !== w || frameSizeRef.current.height !== h) {
      frameSizeRef.current = { width: w, height: h };
      setFrame({ width: w, height: h });
    }
    return { buf: imageData.data.buffer as ArrayBuffer, width: w, height: h };
  }, []);

  const tick = useCallback(() => {
    rafRef.current = requestAnimationFrame(tick);
    const now = Date.now();
    if (now - lastProbeRef.current < PROBE_INTERVAL_MS) return;
    if (pausedRef.current || resultRef.current || processingRef.current) return;
    // Đang chấm hàng loạt → không dò khung camera (tránh đổi trạng thái/đè stage).
    if (batchModeRef.current) return;
    lastProbeRef.current = now;
    const frameData = grabFrame();
    if (!frameData) return;
    const worker = ensureWorker();
    reqIdRef.current += 1;
    worker.postMessage(
      {
        kind: "probe",
        id: reqIdRef.current,
        width: frameData.width,
        height: frameData.height,
        buf: frameData.buf,
        checkSharpness: true,
      },
      [frameData.buf],
    );
  }, [ensureWorker, grabFrame]);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return; // camera đã bật — tránh leak stream
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const message = "Trình duyệt không hỗ trợ camera. Bạn vẫn có thể tải ảnh bài làm lên.";
      setCameraError(message);
      setStage("error");
      setStatus(message);
      return;
    }
    setStage("starting");
    setStatus("Đang mở camera...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      setIsCameraActive(true);
      setStage("searching");
      setStatus("Đưa phiếu vào khung hình — căn 4 góc marker vào khung định vị");
      cooldownUntilRef.current = Date.now() + 600;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const err = e as DOMException;
      const message =
        err?.name === "NotAllowedError"
          ? "Cần cho phép truy cập camera trong trình duyệt"
          : err?.name === "NotFoundError"
            ? "Không tìm thấy camera — bạn có thể tải ảnh bài làm lên"
            : `Không thể mở camera: ${err?.message ?? e}`;
      setCameraError(message);
      setIsCameraActive(false);
      setStage("error");
      setStatus(message);
    }
  }, [tick]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraActive(false);
    setStage("idle");
    setStatus("Camera đang tắt");
    alignedStreakRef.current = 0;
  }, []);

  /** Manual capture — bypasses the stability counter, keeps the sharpness gate. */
  const captureNow = useCallback(() => {
    if (pausedRef.current || resultRef.current || processingRef.current) return;
    const frameData = grabFrame();
    if (!frameData) return;
    sendProcess(false, frameData.buf, frameData.width, frameData.height, true);
  }, [grabFrame, sendProcess]);

  /** Upload path: same pipeline, sharpness gate off (photos are often soft). */
  const scanImage = useCallback(
    async (file: File) => {
      setProcessing(true);
      setStatus(`Đang xử lý ${file.name}...`);
      try {
        const bitmap = await createImageBitmap(file);
        const maxSide = 1800;
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas không sẵn sàng");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        bitmap.close();
        uploadSourceRef.current = true;
        pausedRef.current = false;
        resultRef.current = null;
        setResult(null);
        setPaused(false);
        // Ảnh TẢI LÊN: bật cắt theo khung đỏ của mẫu (có cropBox) + xoay thẳng.
        sendProcess(false, imageData.data.buffer as ArrayBuffer, canvas.width, canvas.height, false, true);
      } catch (e) {
        processingRef.current = false;
        setProcessing(false);
        setStage("error");
        setStatus(e instanceof Error ? e.message : "Không xử lý được ảnh");
      }
    },
    [sendProcess],
  );

  /** Save / Save & Continue: close the result card and resume scanning. */
  const acceptResult = useCallback(() => {
    cooldownUntilRef.current = Date.now() + (optsRef.current.cooldownMs ?? 2500);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setResult(null);
    resultRef.current = null;
    alignedStreakRef.current = 0;
    pausedRef.current = false;
    setPaused(false);
    setStage(isCameraActive ? "searching" : "idle");
    setStatus(isCameraActive ? "Tiếp tục quét..." : "Camera đang tắt");
  }, [isCameraActive]);

  /** Chụp lại: discard the result without saving. */
  const retryResult = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setResult(null);
    resultRef.current = null;
    alignedStreakRef.current = 0;
    pausedRef.current = false;
    setPaused(false);
    setStage("searching");
    setStatus("Đưa phiếu vào khung hình");
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
      workerRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  return {
    videoRef,
    isCameraActive,
    cameraError,
    stage,
    status,
    frame,
    quad,
    sharpness,
    processing,
    paused,
    result,
    startCamera,
    stopCamera,
    captureNow,
    scanImage,
    processFile,
    acceptResult,
    retryResult,
  };
}
