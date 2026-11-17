"use client";

/** Short WebAudio beeps for scan feedback (no audio assets needed). */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startMs: number, durMs: number, gain = 0.12): void {
  const ac = audioCtx();
  if (!ac) return;
  const t0 = ac.currentTime + startMs / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.05);
}

/** Success: two rising tones. */
export function beepSuccess(): void {
  tone(880, 0, 120);
  tone(1320, 130, 180);
}

/** Read error: low double buzz. */
export function beepError(): void {
  tone(220, 0, 140, 0.15);
  tone(180, 160, 200, 0.15);
}

/** Frame locked: single short tick. */
export function beepTick(): void {
  tone(1200, 0, 60, 0.06);
}
