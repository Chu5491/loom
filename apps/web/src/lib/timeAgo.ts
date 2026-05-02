type T = (key: string, vars?: Record<string, string | number>) => string;

export type TimeAgoMode = "long" | "short";

export function formatTimeAgo(iso: string, t: T, mode: TimeAgoMode = "short"): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t(mode === "long" ? "time.justNow" : "time.justNowShort");
  if (m < 60) return t(mode === "long" ? "time.minutesAgo" : "time.minutesShort", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t(mode === "long" ? "time.hoursAgo" : "time.hoursShort", { n: h });
  const d = Math.floor(h / 24);
  return t(mode === "long" ? "time.daysAgo" : "time.daysShort", { n: d });
}
