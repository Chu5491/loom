import { describe, it, expect, beforeEach } from "vitest";
import { createAgent, listAgents } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import {
  addAgentToProject,
  isAgentInProject,
  listProjectIdsForAgent,
  removeAgentFromProject,
} from "../src/db/project-agents.js";
import { getDb } from "../src/db/client.js";

function reset(): void {
  const db = getDb();
  db.exec("DELETE FROM project_agents");
  db.exec("DELETE FROM agents");
  db.exec("DELETE FROM projects");
}

function makeAgent(projectId: string, name: string) {
  return createAgent({
    projectId,
    name,
    adapterKind: "claude-code",
    adapterConfig: {},
  });
}

describe("global agents + project team membership", () => {
  beforeEach(reset);

  it("a created agent auto-joins its origin project team", () => {
    const a = createProject({ name: "A", path: "/tmp/a" });
    const agent = makeAgent(a.id, "builder");
    expect(isAgentInProject(a.id, agent.id)).toBe(true);
    expect(listAgents({ projectId: a.id }).map((x) => x.id)).toContain(agent.id);
  });

  it("the same agent can be reused on another project's team", () => {
    const a = createProject({ name: "A", path: "/tmp/a" });
    const b = createProject({ name: "B", path: "/tmp/b" });
    const agent = makeAgent(a.id, "builder");

    expect(listAgents({ projectId: b.id })).toHaveLength(0);
    addAgentToProject(b.id, agent.id);

    expect(listAgents({ projectId: b.id }).map((x) => x.id)).toContain(agent.id);
    expect(listProjectIdsForAgent(agent.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("listAgents() with no filter returns every global agent", () => {
    const a = createProject({ name: "A", path: "/tmp/a" });
    const b = createProject({ name: "B", path: "/tmp/b" });
    makeAgent(a.id, "x");
    makeAgent(b.id, "y");
    expect(listAgents()).toHaveLength(2);
  });

  it("removing from a team drops it from that project's list only", () => {
    const a = createProject({ name: "A", path: "/tmp/a" });
    const b = createProject({ name: "B", path: "/tmp/b" });
    const agent = makeAgent(a.id, "builder");
    addAgentToProject(b.id, agent.id);

    expect(removeAgentFromProject(b.id, agent.id)).toBe(true);
    expect(listAgents({ projectId: b.id })).toHaveLength(0);
    // still on A and still a global agent.
    expect(listAgents({ projectId: a.id }).map((x) => x.id)).toContain(agent.id);
    expect(listAgents()).toHaveLength(1);
  });

  it("deleting a project removes memberships but not the global agent", () => {
    const a = createProject({ name: "A", path: "/tmp/a" });
    const b = createProject({ name: "B", path: "/tmp/b" });
    const agent = makeAgent(a.id, "builder");
    addAgentToProject(b.id, agent.id);

    // delete project B (cascade removes its membership rows).
    getDb().prepare("DELETE FROM projects WHERE id = ?").run(b.id);
    expect(isAgentInProject(b.id, agent.id)).toBe(false);
    expect(isAgentInProject(a.id, agent.id)).toBe(true);
    expect(listAgents()).toHaveLength(1);
  });
});
