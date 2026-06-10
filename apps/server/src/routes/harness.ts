// 하네스 엣지 CRUD API. from/to 에이전트가 같은 프로젝트 소속인지 검증하고,
// from→to→trigger 중복을 막는다. 트리거 평가/발화는 run-service 단계(추후).

import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import { getAgent } from "../db/agents.js";
import { getProject } from "../db/projects.js";
import { isAgentInProject } from "../db/project-agents.js";
import {
  createHarnessEdge,
  deleteHarnessEdge,
  findDuplicateEdge,
  getHarnessEdge,
  listHarnessEdges,
  updateHarnessEdge,
} from "../db/harness-edges.js";

export const harnessRoute = new Hono();

const triggerEnum = z.enum(["on_success", "on_fail", "on_changes", "manual"]);
const modeEnum = z.enum(["ask", "auto"]);

harnessRoute.get("/", (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId_required" }, 400);
  return c.json({ edges: listHarnessEdges(projectId) });
});

const createSchema = z.object({
  projectId: z.string().min(1),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  trigger: triggerEnum,
  prompt: z.string().max(16384).nullable().optional(),
  carryResult: z.boolean().optional(),
  mode: modeEnum.optional(),
});

harnessRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;

  if (!getProject(data.projectId)) {
    return c.json({ error: "project_not_found" }, 404);
  }
  const from = getAgent(data.fromAgentId);
  const to = getAgent(data.toAgentId);
  if (!from || !to) return c.json({ error: "agent_not_found" }, 404);

  // 두 에이전트 모두 이 프로젝트 *팀*에 속해야 함 — 그래프가 프로젝트에 닫혀 있도록.
  if (
    !isAgentInProject(data.projectId, data.fromAgentId) ||
    !isAgentInProject(data.projectId, data.toAgentId)
  ) {
    return c.json({ error: "agent_not_in_project" }, 400);
  }
  if (data.fromAgentId === data.toAgentId) {
    return c.json({ error: "self_edge_not_allowed" }, 400);
  }
  // 자식이 받을 내용이 있어야 함 — 지시문이나 carry 둘 중 하나는 필수.
  if (!data.prompt?.trim() && !data.carryResult) {
    return c.json({ error: "prompt_or_carry_required" }, 400);
  }
  if (
    findDuplicateEdge({
      fromAgentId: data.fromAgentId,
      toAgentId: data.toAgentId,
      trigger: data.trigger,
    })
  ) {
    return c.json({ error: "duplicate_edge" }, 409);
  }

  const edge = createHarnessEdge(data);
  return c.json({ edge }, 201);
});

const updateSchema = z
  .object({
    trigger: triggerEnum.optional(),
    prompt: z.string().max(16384).nullable().optional(),
    carryResult: z.boolean().optional(),
    mode: modeEnum.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });

harnessRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = getHarnessEdge(id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const data = await parseBody(c, updateSchema);
  if (isResponse(data)) return data;

  // 갱신 후에도 자식이 받을 내용이 남아 있어야 함.
  const prompt = data.prompt !== undefined ? data.prompt : existing.prompt;
  const carry =
    data.carryResult !== undefined ? data.carryResult : existing.carryResult;
  if (!prompt?.trim() && !carry) {
    return c.json({ error: "prompt_or_carry_required" }, 400);
  }

  return c.json({ edge: updateHarnessEdge(id, data) });
});

harnessRoute.delete("/:id", (c) => {
  const ok = deleteHarnessEdge(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
