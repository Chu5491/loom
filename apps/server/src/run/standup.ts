// 스탠드업 리포트 — 지난 24시간의 run 기록(서버가 동봉)과 git log(에이전트가 직접
// 조회)를 근거로 에이전트가 데일리 리포트를 쓴다. 수동 버튼과 스케줄(feature:
// "standup") 양쪽에서 호출. 결과는 data/standup/<projectId>.json (기록 — gitignore).

import fs from "node:fs";
import path from "node:path";
import type { RunInfo } from "@loom/core";
import { paths } from "../config.js";
import { getRunEventsDb, listRunsDb } from "../db.js";
import { readFeaturePrompt } from "../office.js";
import { startRun, waitForRun } from "./engine.js";

const STANDUP_TIMEOUT_MS = 5 * 60_000;
const HISTORY_KEEP = 19;

export interface Standup {
  generatedAt: string;
  agent: string;
  runId: string;
  /** 리포트 본문 — 마크다운 그대로(형식 강제는 프롬프트의 섹션 골격뿐). */
  report: string;
}

function standupPath(projectId: string): string {
  return path.join(paths.data, "standup", `${projectId}.json`);
}

export function getStandup(projectId: string): { standup: Standup | null; history: Standup[] } {
  try {
    const stored = JSON.parse(fs.readFileSync(standupPath(projectId), "utf8"));
    return {
      standup: stored?.standup ?? null,
      history: Array.isArray(stored?.history) ? stored.history : [],
    };
  } catch {
    return { standup: null, history: [] };
  }
}

/** 순수 — run 기록 한 줄 요약. 프롬프트 첫 줄만(컨텍스트 비대 방지). */
export function runLine(r: RunInfo): string {
  const firstLine = r.prompt.split("\n")[0]!.slice(0, 120);
  const cost = r.costUsd != null ? ` ($${r.costUsd.toFixed(4)})` : "";
  const tag = r.workflow ? ` [workflow:${r.workflow}]` : "";
  return `- ${r.startedAt.slice(11, 16)} @${r.agent} ${r.status}${cost}${tag}: ${firstLine}`;
}

/** 순수 — 스탠드업 프롬프트 조립. 출력 골격(섹션)은 고정, 어조는 feature prompt 가. */
export function composeStandupPrompt(runs: RunInfo[], lang: "en" | "ko"): string {
  const lines = runs.map(runLine).join("\n");
  return (
    "Write the daily standup report for this project.\n" +
    "First run `git log --since=24.hours --oneline --stat` (and `git status -s`) in the current directory to see code activity.\n" +
    "Agent run history for the last 24 hours (from the team dashboard):\n" +
    (lines || "(no runs in the last 24 hours)") +
    "\n\nReply in markdown with exactly these sections:\n" +
    "## Done — what was accomplished (from runs + commits)\n" +
    "## In progress / planned — what appears unfinished or queued\n" +
    "## Blockers — failed runs, errors, anything needing a human\n" +
    (lang === "ko" ? "\nWrite the report in Korean.\n" : "")
  );
}

export async function runStandup(
  projectId: string,
  agent: string,
  lang: "en" | "ko",
): Promise<{ ok: true; standup: Standup } | { ok: false; status: number; error: string }> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = listRunsDb({ projectId }).filter((r) => r.startedAt >= since).slice(0, 50);
  const prompt = composeStandupPrompt(recent, lang);

  const started = await startRun({ agent, prompt, projectId, promptOverride: readFeaturePrompt("standup") });
  if (!started.ok) return { ok: false, status: started.status, error: started.error };
  try {
    const done = await waitForRun(started.run.id, STANDUP_TIMEOUT_MS);
    const events = getRunEventsDb(started.run.id);
    const result = [...events].reverse().find((e) => e.kind === "result");
    const report = (result && "text" in result ? result.text : "").trim();
    if (done.status !== "succeeded" || !report) {
      return { ok: false, status: 502, error: `agent run ${done.status}: ${report.slice(0, 200) || "no output"}` };
    }
    const standup: Standup = { generatedAt: new Date().toISOString(), agent, runId: started.run.id, report };
    const prev = getStandup(projectId);
    const history = [prev.standup, ...prev.history].filter(Boolean).slice(0, HISTORY_KEEP) as Standup[];
    fs.mkdirSync(path.join(paths.data, "standup"), { recursive: true });
    fs.writeFileSync(standupPath(projectId), JSON.stringify({ standup, history }, null, 2));
    return { ok: true, standup };
  } catch (e) {
    return { ok: false, status: 504, error: (e as Error).message };
  }
}
