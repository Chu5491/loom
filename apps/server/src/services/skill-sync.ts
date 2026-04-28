import {
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Agent, Project, Spec } from "@loom/core";
import { getAgent } from "../db/agents.js";
import { getDb } from "../db/client.js";
import { getProject } from "../db/projects.js";
import { getSpecsByIds } from "../db/specs.js";

/**
 * Per-agent skill folder layout:
 *   <project.path>/.loom/agents/<agent.id>/skills/<slug>.md
 *
 * Each agent's folder contains *only* the skills the user assigned to them.
 * Other agents' skills live in their own sibling folders, so an `ls` of one
 * agent's directory never reveals another's loadout.
 *
 * The folder is rewritten from scratch on every relevant change (assignment
 * change, skill content change, skill delete). Run start does no IO.
 */

const LOOM_DIR = ".loom";

export function agentSkillsDirFor(project: Project, agent: Agent): string {
  return join(project.path, LOOM_DIR, "agents", agent.id, "skills");
}

/** Slug + collision-safe id suffix when two specs share a name. */
export function skillFileName(spec: Spec, allInBundle: Spec[]): string {
  const slug = slugify(spec.name);
  const collides = allInBundle.some(
    (other) => other.id !== spec.id && slugify(other.name) === slug,
  );
  return collides ? `${slug}-${spec.id.slice(0, 8)}.md` : `${slug}.md`;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "skill";
}

/** First non-empty line, stripped of markdown heading markers. Capped to 120 chars. */
export function firstLineSummary(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const line = trimmed.split("\n")[0]!.replace(/^#+\s*/, "").trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * Rewrite the agent's skill folder so it contains *exactly* the skills
 * currently assigned to it. Idempotent; safe to call any number of times.
 *
 * Best-effort on errors — we log via the supplied callback (default: stderr)
 * but never throw, because failing here shouldn't block agent CRUD.
 */
export function syncAgentSkills(
  agentId: string,
  onError: (msg: string) => void = (m) => process.stderr.write(`[skill-sync] ${m}\n`),
): void {
  try {
    const agent = getAgent(agentId);
    if (!agent) return;
    const project = getProject(agent.projectId);
    if (!project) return;

    const dir = agentSkillsDirFor(project, agent);
    mkdirSync(dir, { recursive: true });

    const skills = getSpecsByIds(agent.skillIds);
    const wanted = new Map<string, Spec>();
    for (const s of skills) wanted.set(skillFileName(s, skills), s);

    // Delete stray files (skills the agent no longer has assigned).
    let existing: string[] = [];
    try {
      existing = readdirSync(dir);
    } catch {
      existing = [];
    }
    for (const f of existing) {
      if (!wanted.has(f)) {
        try {
          unlinkSync(join(dir, f));
        } catch (err) {
          onError(`unlink failed: ${(err as Error).message}`);
        }
      }
    }

    // Write current skills.
    for (const [filename, s] of wanted) {
      try {
        writeFileSync(join(dir, filename), s.content, "utf8");
      } catch (err) {
        onError(`write failed for ${filename}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    onError((err as Error).message);
  }
}

/**
 * Remove an agent's whole skills directory. Call BEFORE deleting the agent
 * row, while we can still resolve project from agent.
 */
export function removeAgentSkillsDir(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) return;
  const project = getProject(agent.projectId);
  if (!project) return;
  const dir = join(project.path, LOOM_DIR, "agents", agentId);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // already gone or unwritable — ignore
  }
}

/**
 * Find every agent that has this skill assigned and re-sync them. Used when
 * a skill's content/name changes or the skill is deleted (call BEFORE delete
 * to capture the affected agents — the agent_skills cascade then drops the
 * row, and this re-sync writes the new shrunk folder).
 */
export function affectedAgentsForSkill(skillId: string): string[] {
  return getDb()
    .prepare<[string], { agent_id: string }>(
      "SELECT agent_id FROM agent_skills WHERE skill_id = ?",
    )
    .all(skillId)
    .map((r) => r.agent_id);
}

export interface SkillManifestEntry {
  filename: string;
  fullPath: string;
  size: number;
  summary: string;
}

export function buildManifestEntries(
  project: Project,
  agent: Agent,
  skills: Spec[],
): SkillManifestEntry[] {
  const dir = agentSkillsDirFor(project, agent);
  return skills.map((s) => {
    const filename = skillFileName(s, skills);
    return {
      filename,
      fullPath: join(dir, filename),
      size: Buffer.byteLength(s.content, "utf8"),
      summary: firstLineSummary(s.content),
    };
  });
}
