"use client";

/** QR code display (share keys) + camera/file QR scanner (import keys). */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";

/** Render text as a QR code onto a canvas. */
export function QrCanvas({ text, size = 220, className }: { text: string; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, text, { width: size, margin: 1 }, (err) => {
      if (err) console.error("QR render failed", err);
    });
  }, [text, size]);
  return <canvas ref={ref} className={className} width={size} height={size} />;
}

/** Download the QR as a PNG file. */
export async function downloadQrPng(text: string, fileName: string, size = 640): Promise<void> {
  const url = await QRCode.toDataURL(text, { width: size, margin: 2 });
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Scan a QR from an image File. Returns null when nothing found. */
export async function scanQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const res = jsQR(data.data, data.width, data.height);
  return res?.data ?? null;
}

/** Live camera QR scanner (getUserMedia + jsQR). */
export function QrCameraScanner({
  onDecode,
  onClose,
}: {
  onDecode: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        const canvas = document.createElement("canvas");
        const tick = () => {
          rafRef.current = requestAnimationFrame(tick);
          const v = videoRef.current;
          if (!v || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !v.videoWidth) return;
          const scale = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(img.data, img.width, img.height);
          if (found?.data && !doneRef.current) {
            doneRef.current = true;
            stop();
            onDecode(found.data);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError("Không mở được camera — hãy dùng nút “Chọn ảnh QR” bên dưới.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onDecode, stop]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
      <div className="card w-full max-w-sm p-4">
        <h3 className="mb-3 font-bold">Quét QR đáp án</h3>
        {error ? (
          <p className="mb-3 text-sm text-red-600">{error}</p>
        ) : (
          <div className="mb-3 aspect-video overflow-hidden rounded-lg bg-slate-950">
            <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary cursor-pointer">
            📁 Chọn ảnh QR
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const text = await scanQrFromFile(f);
                if (text && !doneRef.current) {
                  doneRef.current = true;
                  stop();
                  onDecode(text);
                } else if (!text) {
                  setError("Không tìm thấy QR trong ảnh.");
                }
              }}
            />
          </label>
          <button
            className="btn-ghost ml-auto"
            onClick={() => {
              doneRef.current = true;
              stop();
              onClose();
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
