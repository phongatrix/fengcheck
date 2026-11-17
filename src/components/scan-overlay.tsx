"use client";

/**
 * Positioning overlay drawn on top of the camera preview.
 *
 *  - A guide frame with 4 corner brackets in the template's aspect ratio
 *    (matches the printed sheet's corner markers) tells the user where to
 *    place the paper.
 *  - The live detected quad (4 corner markers) is drawn on top — amber while
 *    searching, green once the sheet is locked.
 */

import { useEffect, useRef } from "react";
import type { Pt } from "@/lib/omr/types";
import type { FrameInfo, ScanStage } from "@/hooks/use-omr-scanner";

interface Props {
  frame: FrameInfo;
  quad: [Pt, Pt, Pt, Pt] | null;
  stage: ScanStage;
  /** width/height of the canonical sheet layout. */
  aspect: number;
  paused: boolean;
}

interface CanvasSize {
  w: number;
  h: number;
}

export default function ScanOverlay({ frame, quad, stage, aspect, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<CanvasSize>({ w: 0, h: 0 });

  // Keep the canvas backing store matched to the element size.
  useEffect(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w > 0 && h > 0 && (sizeRef.current.w !== w || sizeRef.current.h !== h)) {
        sizeRef.current = { w, h };
        canvas.width = w;
        canvas.height = h;
        draw();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w: cw, h: ch } = sizeRef.current;
    ctx.clearRect(0, 0, cw, ch);

    if (cw === 0 || ch === 0) return;

    // Video display rect (object-contain) inside the canvas.
    let vx = 0;
    let vy = 0;
    let vw = cw;
    let vh = ch;
    if (frame.width > 0 && frame.height > 0) {
      const scale = Math.min(cw / frame.width, ch / frame.height);
      vw = frame.width * scale;
      vh = frame.height * scale;
      vx = (cw - vw) / 2;
      vy = (ch - vh) / 2;
    }

    // Guide frame: template aspect, centred in the video rect with margin.
    const margin = 14;
    let gw = vw - margin * 2;
    let gh = gw / aspect;
    if (gh > vh - margin * 2) {
      gh = vh - margin * 2;
      gw = gh * aspect;
    }
    const gx = vx + (vw - gw) / 2;
    const gy = vy + (vh - gh) / 2;

    const aligned = stage === "aligned" || stage === "processing";
    const guideColor = aligned ? "34, 197, 94" : "255, 255, 255";

    // Dim outside the guide frame.
    ctx.save();
    ctx.fillStyle = "rgba(2, 6, 23, 0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(gx, gy, gw, gh);
    ctx.fill("evenodd");
    ctx.restore();

    // Guide border + corner brackets.
    ctx.strokeStyle = `rgba(${guideColor}, 0.85)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, gw, gh);
    const arm = Math.max(16, Math.min(gw, gh) * 0.06);
    ctx.strokeStyle = aligned ? "rgb(34, 197, 94)" : "rgb(56, 189, 248)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    const corners: [number, number, number, number][] = [
      [gx, gy, 1, 1],
      [gx + gw, gy, -1, 1],
      [gx + gw, gy + gh, -1, -1],
      [gx, gy + gh, 1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
      ctx.stroke();
    }

    // Detected quad in frame coords → canvas coords.
    if (quad && frame.width > 0) {
      const scale = Math.min(cw / frame.width, ch / frame.height);
      const dx = (cw - frame.width * scale) / 2;
      const dy = (ch - frame.height * scale) / 2;
      const pts = quad.map((p) => ({ x: p.x * scale + dx, y: p.y * scale + dy }));
      ctx.strokeStyle = aligned ? "rgb(34, 197, 94)" : "rgb(250, 204, 21)";
      ctx.lineWidth = 3;
      ctx.setLineDash(aligned ? [] : [8, 6]);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgb(34, 197, 94)";
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (paused) {
      ctx.fillStyle = "rgba(2, 6, 23, 0.35)";
      ctx.fillRect(0, 0, cw, ch);
    }
  };

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, quad, stage, aspect, paused]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
