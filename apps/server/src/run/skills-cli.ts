// 오픈 스킬 생태계(`npx skills`, https://skills.sh) 연동 — 검색 + 가져오기.
// 가져오기는 임시 staging 으로 설치 → skill-author run 으로 loom 스타일 다듬기 →
// office/skills 기록. find-skills 스킬이 안내하는 그 CLI 를 서버가 대신 부른다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnCapture, stripAnsi } from "@loom/adapter-utils";
import type { SkillSpec } from "@loom/core";
import { readAgents, safeName, splitFrontmatter, writeSkillFromFolder } from "../office.js";
import { extractJson, pickAuthor, runAuthor } from "./author.js";

const CLI_TIMEOUT_MS = 90_000;

export interface SkillCandidate {
  /** `owner/repo@skill` — `skills add` 에 그대로 넘기는 식별자. */
  pkg: string;
  /** 설치 수(품질 신호). 파싱 실패 시 null. */
  installs: number | null;
  url: string | null;
  /** owner — 출처 신뢰 판단용(공식 owner 강조). */
  source: string;
}

const OFFICIAL = new Set(["vercel-labs", "anthropics", "microsoft", "openai"]);
export function isOfficialSource(owner: string): boolean {
  return OFFICIAL.has(owner.toLowerCase());
}

// "2.5K installs" / "826 installs" → 숫자. 실패 시 null.
function parseInstalls(s: string): number | null {
  const m = /([\d.]+)\s*([KkMm]?)\s*installs?/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (Number.isNaN(n)) return null;
  const mult = m[2]!.toLowerCase() === "k" ? 1_000 : m[2]!.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(n * mult);
}

/** `skills find` 출력(ANSI 제거 후)에서 후보를 뽑는다 — 순수. 테스트 대상.
 *  포맷: `owner/repo@skill   N installs` 줄 + 다음 줄에 `└ https://skills.sh/...`. */
export function parseSkillsFind(raw: string): SkillCandidate[] {
  const lines = stripAnsi(raw).split(/\r?\n/);
  const out: SkillCandidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // owner/repo@skill — owner·repo·skill 은 영숫자/._- 로 구성.
    const m = /^([\w.-]+\/[\w.-]+@[\w.-]+)\b(.*)$/.exec(line);
    if (!m) continue;
    const pkg = m[1]!;
    const urlLine = (lines[i + 1] ?? "").trim();
    const urlM = /(https?:\/\/\S+)/.exec(urlLine) ?? /(https?:\/\/\S+)/.exec(line);
    out.push({
      pkg,
      installs: parseInstalls(m[2]!),
      url: urlM ? urlM[1]!.replace(/[)\]}.,]+$/, "") : null,
      source: pkg.split("/")[0]!,
    });
  }
  return out;
}

export async function findSkills(query: string): Promise<SkillCandidate[]> {
  const r = await spawnCapture("npx", ["-y", "skills", "find", query], { timeoutMs: CLI_TIMEOUT_MS });
  if (r.timedOut) throw new Error("skills find timed out");
  // skills CLI 는 결과를 stdout/stderr 어느 쪽에 쓸지 일정치 않아 둘 다 본다.
  const candidates = parseSkillsFind(`${r.stdout}\n${r.stderr}`);
  if (candidates.length === 0 && r.exitCode !== 0) {
    throw new Error(`skills find failed: ${stripAnsi(r.stderr || r.stdout).slice(0, 200)}`);
  }
  return candidates;
}

// staging 디렉토리에서 설치된 SKILL.md 폴더를 찾는다(`<cwd>/.agents/skills/<name>/`).
function findInstalledSkill(stage: string): string | null {
  const base = path.join(stage, ".agents", "skills");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(base);
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (fs.existsSync(path.join(base, d, "SKILL.md"))) return path.join(base, d);
  }
  return null;
}

export interface ImportedSkill {
  skill: SkillSpec;
  /** LLM 다듬기 적용 여부(실패 시 원본 그대로 들임). */
  adapted: boolean;
  skipped: string[];
}

/** `owner/repo@skill` 을 가져와 loom 스타일로 다듬어 office/skills 에 기록. */
export async function importSkill(pkg: string): Promise<ImportedSkill> {
  if (!/^[\w.-]+\/[\w.-]+@[\w.-]+$/.test(pkg)) throw new Error(`bad skill package: ${pkg}`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "loom-skill-"));
  try {
    const r = await spawnCapture("npx", ["-y", "skills", "add", pkg], { timeoutMs: CLI_TIMEOUT_MS, cwd: stage });
    const srcDir = findInstalledSkill(stage);
    if (!srcDir) throw new Error(`skills add produced no skill: ${stripAnsi(r.stderr || r.stdout).slice(0, 200)}`);

    const raw = fs.readFileSync(path.join(srcDir, "SKILL.md"), "utf8");
    const { meta, body } = splitFrontmatter(raw);
    const name = safeName(meta.name || path.basename(srcDir));
    const fileList = fs.existsSync(srcDir) ? listTopFiles(srcDir) : [];

    // skill-author run 으로 다듬기 — 실패하면 원본 그대로(가져오기는 성공시킴).
    let description = meta.description || `Imported skill ${name}`;
    let adaptedBody = body;
    let adapted = false;
    const author = pickAuthor(readAgents());
    if (author) {
      try {
        const out = await runAuthor(author.name, "skill-author",
          `Skill name: ${name}\nAttached files: ${fileList.join(", ") || "(none)"}\n\n--- SKILL.md body ---\n${body}`);
        const j = extractJson(out) as { description?: unknown; body?: unknown };
        if (typeof j.body === "string" && j.body.trim()) adaptedBody = j.body;
        if (typeof j.description === "string" && j.description.trim()) description = j.description.trim();
        adapted = true;
      } catch {
        // 다듬기 실패는 치명적이지 않다 — 원본으로 들이고 사용자가 손보면 된다.
      }
    }

    const { skill, skipped } = writeSkillFromFolder(name, description, adaptedBody, srcDir);
    return { skill, adapted, skipped };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function listTopFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f !== "SKILL.md" && !f.startsWith("."));
  } catch {
    return [];
  }
}
