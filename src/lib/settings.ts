"use client";

/**
 * App settings persisted in localStorage (small, synchronous, no schema table).
 * Quiz/key/score data lives in IndexedDB (see lib/db.ts).
 */

export interface AppSettings {
  /** Quiz currently selected for grading in the scan screen. */
  activeQuizId: string | null;
  /** Beep on scan result. */
  sound: boolean;
  /** Auto-capture when the frame is aligned & sharp. */
  autoScan: boolean;
  /** Cooldown after a successful scan (ms) — mirrors the app's c*1000. */
  cooldownMs: number;
  /** Default maximum score when a quiz doesn't define a ladder. */
  maxScore: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeQuizId: null,
  sound: true,
  autoScan: true,
  cooldownMs: 2500,
  maxScore: 10,
};

const KEY = "chambai-webcam-settings";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full / private mode — settings simply won't persist.
  }
}
