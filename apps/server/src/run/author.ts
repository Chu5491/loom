// 생성(authoring) run — 에이전트가 스킬/에이전트 정의를 프롬프트로 만들어낸다.
// standup 과 같은 패턴: startRun(promptOverride) → waitForRun → result 텍스트.
// 컨텍스트(스킬·mcp·어댑터 목록 등)는 프롬프트에 동봉하므로 프로젝트/도구 불필요.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnCapture } from "@loom/adapter-utils";
import type { AgentSpec } from "@loom/core";
import { readFeaturePrompt, type FeaturePromptName } from "../office.js";
import { getRunEventsDb } from "../db.js";
import { cancelRun, startRun, waitForRun } from "./engine.js";

const AUTHOR_TIMEOUT_MS = 5 * 60_000;

/** roles 에 author 가 있는 에이전트 우선, 없으면 null(라우트가 안내). */
export function pickAuthor(agents: AgentSpec[], override?: string): AgentSpec | null {
  if (override) return agents.find((a) => a.name === override) ?? null;
  return agents.find((a) => a.roles?.includes("author")) ?? null;
}

// 첫 { 부터 짝 맞는 } 까지 잘라낸다(문자열 안의 중괄호·백틱은 무시) — 펜스/프로즈
// 와 무관. 펜스 정규식은 본문에 ``` 코드블록이 있으면 거기서 잘려 깨지므로 안 쓴다.
function sliceBalanced(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** LLM 출력에서 첫 JSON 객체를 꺼낸다 — ```json 펜스/서두 잡텍스트(중괄호 포함)를
 *  견딘다. 각 { 위치에서 파싱을 시도해 처음 성공하는 것을 반환. 순수 — 테스트 대상. */
export function extractJson(text: string): unknown {
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const slice = sliceBalanced(text, i);
    if (!slice) continue;
    try {
      return JSON.parse(slice);
    } catch {
      // 이 { 는 JSON 시작이 아니었다(프로즈의 중괄호 등) — 다음 { 로.
    }
  }
  throw new Error("no JSON object in output");
}

// authoring 은 파일이 필요 없지만(컨텍스트는 프롬프트에 동봉) codex 등은 신뢰/깃
// 디렉토리에서만 돌아 cwd 가 필요하다. git-init 한 임시 디렉토리로 격리 — 실제
// 파일과 분리되고 어떤 LOOM_HOME 에서도 codex 의 git-repo 체크를 통과한다.
async function makeScratchRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-author-"));
  await spawnCapture("git", ["init", "-q"], { cwd: dir, timeoutMs: 10_000 });
  return dir;
}

/** authoring run 을 돌려 result 텍스트를 반환. 실패는 throw. */
export async function runAuthor(
  authorAgent: string,
  feature: FeaturePromptName,
  prompt: string,
): Promise<string> {
  const scratch = await makeScratchRepo();
  const started = await startRun({
    agent: authorAgent,
    prompt,
    promptOverride: readFeaturePrompt(feature),
    cwd: scratch,
  });
  if (!started.ok) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw new Error(started.error);
  }
  try {
    const done = await waitForRun(started.run.id, AUTHOR_TIMEOUT_MS);
    const events = getRunEventsDb(started.run.id);
    const result = [...events].reverse().find((e) => e.kind === "result");
    const text = (result && "text" in result ? result.text : "").trim();
    if (done.status !== "succeeded" || !text) {
      throw new Error(`author run ${done.status}: ${text.slice(0, 200) || "no output"}`);
    }
    return text;
  } catch (e) {
    // 타임아웃이면 자식이 아직 도는 중 — 고아 방지로 끊는다.
    cancelRun(started.run.id);
    throw e;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
