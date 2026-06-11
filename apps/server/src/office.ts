// office-as-code 로더/세이버. office/ 디렉토리의 파일 ↔ 메모리 객체.
// 정의의 유일한 원천 — DB 없음, CLI root 안 건드림. zod 로 경계 검증.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  AgentSpec,
  McpServer,
  Office,
  RuleSpec,
  SkillSpec,
  WorkflowSpec,
} from "@loom/core";
import { paths } from "./config.js";

// ── 안전한 이름 (경로 traversal 차단) ───────────────────────────────────────
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
export function safeName(name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`bad name: ${name}`);
  return name;
}

const dir = {
  rules: () => path.join(paths.office, "rules"),
  skills: () => path.join(paths.office, "skills"),
  agents: () => path.join(paths.office, "agents"),
  workflows: () => path.join(paths.office, "workflows"),
  mcpFile: () => path.join(paths.office, "mcp", "servers.json"),
};

// ── zod 스키마 (입력 경계 검증) ─────────────────────────────────────────────
const adapterKind = z.enum([
  "claude-code",
  "antigravity",
  "codex",
  "opencode",
  "devin",
]);

export const ruleSchema = z.object({ body: z.string().max(100_000) });
export const skillSchema = z.object({
  description: z.string().max(2000),
  body: z.string().max(100_000),
});
const mcpServerSchema = z.object({
  name: z.string().regex(NAME_RE),
  description: z.string().nullable().default(null),
  kind: z.enum(["stdio", "http", "sse"]),
  command: z.string().nullable().default(null),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  url: z.string().nullable().default(null),
  headers: z.record(z.string(), z.string()).default({}),
});
export const mcpListSchema = z.object({ servers: z.array(mcpServerSchema) });
export const agentSchema = z.object({
  adapter: adapterKind,
  label: z.string().optional(),
  color: z.string().optional(),
  model: z.string().optional(),
  reasoning: z.enum(["high", "medium", "low"]).optional(),
  permission: z.enum(["default", "acceptEdits", "bypass"]).optional(),
  delegate: z.boolean().optional(),
  roles: z.array(z.enum(["git", "analyst"])).optional(),
  prompt: z.string().optional(),
  rules: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  mcp: z.array(z.string()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
// 워크플로우 — 노드 id 는 캔버스 로컬 식별자(n1…), entry/edges 의 참조 무결성은
// 라우트에서 검증(스키마는 형태만).
const workflowNodeSchema = z.object({
  id: z.string().regex(NAME_RE),
  kind: z.enum(["agent", "gate"]).optional(),
  // gate 노드는 agent 미사용 — 빈 문자열 허용(에이전트 존재 검증은 라우트에서 kind 별로).
  agent: z.string(),
  prompt: z.string().max(20_000),
  x: z.number().optional(),
  y: z.number().optional(),
});
const workflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  on: z.enum(["success", "fail", "always"]),
});
export const workflowSchema = z.object({
  description: z.string().optional(),
  trigger: z
    .object({
      agent: z.string().min(1),
      on: z.enum(["success", "fail", "changes"]),
      mode: z.enum(["auto", "ask"]),
    })
    .nullable()
    .optional(),
  entry: z.string(),
  nodes: z.array(workflowNodeSchema).min(1).max(20),
  edges: z.array(workflowEdgeSchema).max(40),
});

// ── frontmatter (의존성 없이 — `---` 펜스 사이 key: value 만) ────────────────
function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] ?? "" };
}

function listMd(d: string): string[] {
  try {
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
}
function listJson(d: string): string[] {
  try {
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
}

// ── 읽기 ────────────────────────────────────────────────────────────────────
export function readRules(): RuleSpec[] {
  return listMd(dir.rules()).map((name) => ({
    name,
    body: fs.readFileSync(path.join(dir.rules(), `${name}.md`), "utf8"),
  }));
}

// 폴더 스킬의 딸린 파일 수집 — SKILL.md 제외, 폴더 기준 상대경로. 폭주 방지 cap.
function listSkillFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string, depth: number): void => {
    if (depth > 4 || out.length >= 200) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), relPath, depth + 1);
      else if (e.isFile() && relPath !== "SKILL.md") out.push(relPath);
    }
  };
  walk(root, "", 0);
  return out;
}

export function readSkills(): SkillSpec[] {
  const root = dir.skills();
  const single = listMd(root).map((name): SkillSpec => {
    const raw = fs.readFileSync(path.join(root, `${name}.md`), "utf8");
    const { meta, body } = splitFrontmatter(raw);
    return { name, description: meta.description ?? "", body, files: [] };
  });

  // 폴더 스킬: <name>/SKILL.md 가 본문, 나머지 파일은 references 로 함께 실린다.
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && NAME_RE.test(e.name));
  } catch {
    // skills 디렉토리 자체가 없으면 빈 목록
  }
  const folder = dirs.flatMap((d): SkillSpec[] => {
    const skillMd = path.join(root, d.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) return [];
    const { meta, body } = splitFrontmatter(fs.readFileSync(skillMd, "utf8"));
    return [{ name: d.name, description: meta.description ?? "", body, files: listSkillFiles(path.join(root, d.name)) }];
  });

  return [...single, ...folder].sort((a, b) => a.name.localeCompare(b.name));
}

export function readMcp(): McpServer[] {
  try {
    const parsed = mcpListSchema.parse(
      JSON.parse(fs.readFileSync(dir.mcpFile(), "utf8")),
    );
    return parsed.servers;
  } catch {
    return [];
  }
}

export function readAgents(): AgentSpec[] {
  return listJson(dir.agents()).map((name) => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir.agents(), `${name}.json`), "utf8"),
    );
    return { name, ...agentSchema.parse(raw) };
  });
}

// ── 기능 프롬프트 — git 커밋·프로젝트 분석 같은 내장 기능의 지침(스타일·관점).
// 양식(출력 형식)은 서버 코드에 고정, 이 파일은 그 앞에 붙는 조정 가능한 부분.
// 에이전트 프롬프트와 분리 — 기능 실행 시 에이전트의 prompt 대신 이게 쓰인다.
export const FEATURE_PROMPT_NAMES = ["git-commit", "analysis"] as const;
export type FeaturePromptName = (typeof FEATURE_PROMPT_NAMES)[number];

const DEFAULT_FEATURE_PROMPTS: Record<FeaturePromptName, string> = {
  "git-commit":
    "You are writing a commit message for this repository.\n" +
    "Match the language of the diff and codebase comments. Be concise; the body explains WHY, not WHAT.\n",
  analysis:
    "You are analyzing this repository for its team dashboard.\n" +
    "Be honest and specific — scores should reflect reality, risks should be actionable, suggestions concrete.\n",
};

function featurePromptFile(name: FeaturePromptName): string {
  return path.join(paths.office, "prompts", `${name}.md`);
}

export function readFeaturePrompt(name: FeaturePromptName): string {
  try {
    return fs.readFileSync(featurePromptFile(name), "utf8");
  } catch {
    return DEFAULT_FEATURE_PROMPTS[name]; // 파일이 없으면 기본값 — 저장 시 생성
  }
}

export function readFeaturePrompts(): RuleSpec[] {
  return FEATURE_PROMPT_NAMES.map((name) => ({ name, body: readFeaturePrompt(name) }));
}

export function writeFeaturePrompt(name: FeaturePromptName, body: string): RuleSpec {
  writeFileEnsured(featurePromptFile(name), body);
  return { name, body };
}

export function readWorkflows(): WorkflowSpec[] {
  return listJson(dir.workflows()).flatMap((name) => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir.workflows(), `${name}.json`), "utf8"));
      return [{ name, ...workflowSchema.parse(raw) }];
    } catch {
      return []; // 깨진 정의는 목록에서 제외 — 파일은 보존(사용자가 고침)
    }
  });
}

export function readOffice(): Office {
  return {
    rules: readRules(),
    skills: readSkills(),
    mcp: readMcp(),
    agents: readAgents(),
    workflows: readWorkflows(),
    prompts: readFeaturePrompts(),
  };
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────
function writeFileEnsured(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function writeRule(name: string, body: string): RuleSpec {
  writeFileEnsured(path.join(dir.rules(), `${safeName(name)}.md`), body);
  return { name, body };
}

export function writeSkill(name: string, description: string, body: string): SkillSpec {
  const fm = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${body}`;
  const folder = path.join(dir.skills(), safeName(name));
  // 폴더 스킬이면 본문은 SKILL.md 에 — 딸린 파일은 건드리지 않는다.
  if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
    writeFileEnsured(path.join(folder, "SKILL.md"), fm);
    return { name, description, body, files: listSkillFiles(folder) };
  }
  writeFileEnsured(path.join(dir.skills(), `${safeName(name)}.md`), fm);
  return { name, description, body, files: [] };
}

// ── 스킬 딸린 파일 (폴더 스킬) ───────────────────────────────────────────────
// 상대경로 검증 — traversal 차단, 세그먼트별 안전 문자, 깊이 cap. SKILL.md 는 본문 전용.
const SEG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export function safeRelPath(rel: string): string {
  const segs = rel.split("/");
  if (segs.length === 0 || segs.length > 4) throw new Error(`bad path depth: ${rel}`);
  for (const s of segs) {
    if (!SEG_RE.test(s) || s === ".." || s === ".") throw new Error(`bad path segment: ${s}`);
  }
  if (rel === "SKILL.md") throw new Error("SKILL.md is the skill body — edit it via the skill itself");
  return rel;
}

function skillFolder(name: string): string {
  return path.join(dir.skills(), safeName(name));
}

/** 단일 .md 스킬을 폴더 스킬로 승격 — <name>.md → <name>/SKILL.md. 이미 폴더면 noop. */
function ensureSkillFolder(name: string): string {
  const folder = skillFolder(name);
  if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) return folder;
  const single = path.join(dir.skills(), `${safeName(name)}.md`);
  if (!fs.existsSync(single)) throw new Error(`skill not found: ${name}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.renameSync(single, path.join(folder, "SKILL.md"));
  return folder;
}

export function readSkillFile(name: string, rel: string): string {
  return fs.readFileSync(path.join(skillFolder(name), safeRelPath(rel)), "utf8");
}

export function writeSkillFile(name: string, rel: string, content: string): SkillSpec {
  const folder = ensureSkillFolder(name);
  writeFileEnsured(path.join(folder, safeRelPath(rel)), content);
  const found = readSkills().find((s) => s.name === name);
  if (!found) throw new Error(`skill not found after write: ${name}`);
  return found;
}

export function deleteSkillFile(name: string, rel: string): boolean {
  return rmIfExists(path.join(skillFolder(name), safeRelPath(rel)));
}

export function writeMcp(servers: McpServer[]): McpServer[] {
  writeFileEnsured(dir.mcpFile(), JSON.stringify({ servers }, null, 2));
  return servers;
}

export function writeAgent(name: string, spec: Omit<AgentSpec, "name">): AgentSpec {
  writeFileEnsured(
    path.join(dir.agents(), `${safeName(name)}.json`),
    JSON.stringify(spec, null, 2),
  );
  return { name, ...spec };
}

export function writeWorkflow(name: string, spec: Omit<WorkflowSpec, "name">): WorkflowSpec {
  writeFileEnsured(
    path.join(dir.workflows(), `${safeName(name)}.json`),
    JSON.stringify(spec, null, 2),
  );
  return { name, ...spec };
}

// ── 삭제 ────────────────────────────────────────────────────────────────────
function rmIfExists(file: string): boolean {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
export const deleteRule = (name: string) =>
  rmIfExists(path.join(dir.rules(), `${safeName(name)}.md`));
export const deleteSkill = (name: string) => {
  const folder = path.join(dir.skills(), safeName(name));
  if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
    fs.rmSync(folder, { recursive: true, force: true });
    return true;
  }
  return rmIfExists(path.join(dir.skills(), `${safeName(name)}.md`));
};
export const deleteAgent = (name: string) =>
  rmIfExists(path.join(dir.agents(), `${safeName(name)}.json`));
export const deleteWorkflow = (name: string) =>
  rmIfExists(path.join(dir.workflows(), `${safeName(name)}.json`));

/** 첫 실행 시 office/ 골격 + 예시 한 개씩. 이미 있으면 noop. */
// 기본 MCP 4종 — 코딩 에이전트의 표준 장비(웹검색·코드검색·문서·위키). remote 라
// 설치 없이 동작, secret 불필요. 에이전트가 opt-in 해야 실리므로 자동주입 아님.
export const DEFAULT_MCP: McpServer[] = [
  { name: "exa", description: "Web search (Exa)", kind: "http", command: null, args: [], env: {}, url: "https://mcp.exa.ai/mcp?tools=web_search_exa", headers: {} },
  { name: "grep-app", description: "Code search across public repos (grep.app)", kind: "http", command: null, args: [], env: {}, url: "https://mcp.grep.app", headers: {} },
  { name: "context7", description: "Up-to-date library docs (Context7)", kind: "http", command: null, args: [], env: {}, url: "https://mcp.context7.com/mcp", headers: {} },
  { name: "deepwiki", description: "GitHub repo wiki/Q&A (DeepWiki)", kind: "http", command: null, args: [], env: {}, url: "https://mcp.deepwiki.com/mcp", headers: {} },
];

export function ensureOffice(): void {
  if (fs.existsSync(paths.office)) return;
  writeRule(
    "global",
    "# Global rules\n\nKeep changes minimal and explain non-obvious decisions.\n",
  );
  writeMcp(DEFAULT_MCP);
}
