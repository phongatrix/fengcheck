/** Rect / point helpers and quadrature geometry used by the OMR pipeline. */

import type { Pt, RectI } from "./types";

export function rectCenter(r: RectI): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectContains(r: RectI, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectIou(a: RectI, b: RectI): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function polygonArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Order 4 arbitrary points as TL, TR, BR, BL. */
export function orderQuad(pts: Pt[]): [Pt, Pt, Pt, Pt] | null {
  if (pts.length !== 4) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const withAngle = pts.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }));
  // Sort counter-clockwise starting from the top-left quadrant.
  withAngle.sort((a, b) => a.a - b.a);
  const ordered = withAngle.map((v) => v.p);
  // Start at the point closest to the top-left corner in sum terms.
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = ordered[i].x + ordered[i].y;
    if (s < best) {
      best = s;
      start = i;
    }
  }
  const rot = [...ordered.slice(start), ...ordered.slice(0, start)];
  // Ensure clockwise visual order TL,TR,BR,BL by checking signed area sign.
  const signed =
    (rot[1].x - rot[0].x) * (rot[2].y - rot[0].y) - (rot[1].y - rot[0].y) * (rot[2].x - rot[0].x);
  return signed > 0 ? [rot[0], rot[1], rot[2], rot[3]] : [rot[0], rot[3], rot[2], rot[1]];
}

/** Long-edge / short-edge ratio of a quad. */
export function quadAspect(quad: [Pt, Pt, Pt, Pt]): number {
  const wTop = dist(quad[0], quad[1]);
  const wBottom = dist(quad[3], quad[2]);
  const hLeft = dist(quad[0], quad[3]);
  const hRight = dist(quad[1], quad[2]);
  const w = (wTop + wBottom) / 2;
  const h = (hLeft + hRight) / 2;
  return h > 0 ? w / h : 0;
}
