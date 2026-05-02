// React 의존성 없는 채팅 유틸 + 타입.

import type { Run } from "@loom/core";

export const CONTINUATION_WINDOW_MS = 5 * 60 * 1000;

export interface TailEvent {
  kind: "text" | "tool";
  text: string;
  detail?: string;
}

export interface FeedItem {
  kind: "user" | "agent";
  run: Run;
  ts: string;
  senderId: string;
}

export interface ThreadGroup {
  rootId: string;
  runs: Run[];
  items: FeedItem[];
  firstTs: string;
  lastTs: string;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string, t: (key: string) => string): string {
  const k = dayKey(iso);
  const today = new Date();
  const todayKey = dayKey(today.toISOString());
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (k === todayKey) return t("chat.today");
  if (k === dayKey(yest.toISOString())) return t("chat.yesterday");
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function summarizeToolInput(
  name: string,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;
  const v = (k: string) => {
    const x = input[k];
    return typeof x === "string" && x.length > 0 ? x : undefined;
  };
  switch (name) {
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "Read":
      return v("file_path");
    case "NotebookEdit":
    case "NotebookRead":
      return v("notebook_path");
    case "Bash":
      return v("command");
    case "Glob":
    case "Grep":
      return v("pattern");
    default:
      return undefined;
  }
}
