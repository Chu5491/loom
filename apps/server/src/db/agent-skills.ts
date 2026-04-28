import { getDb } from "./client.js";

/** Returns the skill ids assigned to a single agent, in the order they were assigned. */
export function listSkillIdsForAgent(agentId: string): string[] {
  const rows = getDb()
    .prepare<[string], { skill_id: string }>(
      `SELECT skill_id FROM agent_skills WHERE agent_id = ? ORDER BY created_at ASC`,
    )
    .all(agentId);
  return rows.map((r) => r.skill_id);
}

/**
 * Replaces the agent's skill assignments with `skillIds`. Done atomically so
 * partial failure can't leave the agent half-updated.
 */
export function setSkillIdsForAgent(agentId: string, skillIds: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction((ids: string[]) => {
    db.prepare("DELETE FROM agent_skills WHERE agent_id = ?").run(agentId);
    const insert = db.prepare(
      "INSERT INTO agent_skills (agent_id, skill_id, created_at) VALUES (?, ?, ?)",
    );
    for (const id of ids) insert.run(agentId, id, now);
  });
  tx(skillIds);
}
