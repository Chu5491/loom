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

export function readSkills(): SkillSpec[] {
  return listMd(dir.skills()).map((name) => {
    const raw = fs.readFileSync(path.join(dir.skills(), `${name}.md`), "utf8");
    const { meta, body } = splitFrontmatter(raw);
    return { name, description: meta.description ?? "", body };
  });
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
  writeFileEnsured(path.join(dir.skills(), `${safeName(name)}.md`), fm);
  return { name, description, body };
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
export const deleteSkill = (name: string) =>
  rmIfExists(path.join(dir.skills(), `${safeName(name)}.md`));
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
