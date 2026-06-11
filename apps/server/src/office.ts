// office-as-code 로더/세이버. office/ 디렉토리의 파일 ↔ 메모리 객체.
// 정의의 유일한 원천 — DB 없음, CLI root 안 건드림. zod 로 경계 검증.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  AgentSpec,
  HarnessEdge,
  McpServer,
  Office,
  RuleSpec,
  SkillSpec,
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
  mcpFile: () => path.join(paths.office, "mcp", "servers.json"),
  edgesFile: () => path.join(paths.office, "harness", "edges.json"),
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
  prompt: z.string().optional(),
  rules: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  mcp: z.array(z.string()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  trigger: z.enum(["on_success", "on_fail", "on_changes", "manual"]),
  mode: z.enum(["ask", "auto"]),
  prompt: z.string().optional(),
  carryResult: z.boolean().optional(),
});
export const edgesListSchema = z.object({ edges: z.array(edgeSchema) });

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

export function readEdges(): HarnessEdge[] {
  try {
    return edgesListSchema.parse(
      JSON.parse(fs.readFileSync(dir.edgesFile(), "utf8")),
    ).edges;
  } catch {
    return [];
  }
}

export function readOffice(): Office {
  return {
    rules: readRules(),
    skills: readSkills(),
    mcp: readMcp(),
    agents: readAgents(),
    edges: readEdges(),
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

export function writeEdges(edges: HarnessEdge[]): HarnessEdge[] {
  writeFileEnsured(dir.edgesFile(), JSON.stringify({ edges }, null, 2));
  return edges;
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

/** 첫 실행 시 office/ 골격 + 예시 한 개씩. 이미 있으면 noop. */
export function ensureOffice(): void {
  if (fs.existsSync(paths.office)) return;
  writeRule(
    "global",
    "# Global rules\n\nKeep changes minimal and explain non-obvious decisions.\n",
  );
  writeMcp([]);
  writeEdges([]);
}
