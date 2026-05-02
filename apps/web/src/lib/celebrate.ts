// 마일스톤 컨페티 — localStorage flag로 1회만 발사.

import confetti from "canvas-confetti";

const STORAGE_PREFIX = "loom:milestone:";
const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];

export type Milestone = "firstAgent" | "firstSuccessfulRun" | "firstProject";

export function celebrate(milestone: Milestone): void {
  if (typeof window === "undefined") return;
  const key = STORAGE_PREFIX + milestone;
  try {
    if (window.localStorage.getItem(key) === "1") return;
    window.localStorage.setItem(key, "1");
  } catch {
    return;
  }

  const end = Date.now() + 600;
  const frame = () => {
    confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: COLORS });
    confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: COLORS });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

export function resetMilestone(milestone: Milestone): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + milestone);
  } catch {
    /* noop */
  }
}
