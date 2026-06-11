// loom MCP 서버 — 도구 하나(delegate)를 노출하는 미니멀 streamable-HTTP 구현.
// 위임을 허용한 에이전트의 loadout 에 http://…/api/mcp?runId=<id> 로 실린다.
// SDK 없이 JSON-RPC 세 메서드만: initialize / tools/list / tools/call.

import { Hono } from "hono";
import { readAgents } from "../office.js";
import { delegateFromRun, getRun } from "../run/engine.js";

export const mcpRoute = new Hono();

interface RpcReq {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: RpcReq["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: RpcReq["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

// delegate 도구 스키마 — 팀원 enum + 소개를 직접 싣는다(모델이 적임자를 고르게).
function delegateTool(selfAgent: string | null) {
  const teammates = readAgents().filter((a) => a.name !== selfAgent);
  const lines = teammates.map((a) => `- ${a.name} (${a.adapter}${a.model ? `, ${a.model}` : ""})${a.prompt ? `: ${a.prompt.slice(0, 120)}` : ""}`);
  return {
    name: "delegate",
    description:
      "Delegate a task to a teammate agent and get its result back. " +
      "Use when a teammate is better suited for a sub-task. Teammates:\n" + lines.join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: teammates.map((a) => a.name), description: "Teammate to delegate to" },
        task: { type: "string", description: "Complete, self-contained task description for the teammate" },
      },
      required: ["agent", "task"],
    },
  };
}

mcpRoute.post("/", async (c) => {
  const runId = c.req.query("runId") ?? "";
  let body: RpcReq | RpcReq[];
  try {
    body = await c.req.json();
  } catch {
    return c.json(err(null, -32700, "parse error"), 400);
  }
  // 배치는 안 씀 — 단건만.
  const req = Array.isArray(body) ? body[0]! : body;

  // 알림(notifications/*)은 응답 본문 없이 202.
  if (req.method.startsWith("notifications/")) return c.body(null, 202);

  switch (req.method) {
    case "initialize":
      return c.json(
        ok(req.id, {
          protocolVersion: (req.params?.protocolVersion as string) ?? "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "loom", version: "2.0.0" },
        }),
      );

    case "tools/list": {
      const self = getRun(runId)?.agent ?? null;
      return c.json(ok(req.id, { tools: [delegateTool(self)] }));
    }

    case "tools/call": {
      const p = req.params as { name?: string; arguments?: { agent?: string; task?: string } } | undefined;
      if (p?.name !== "delegate") return c.json(err(req.id, -32602, `unknown tool: ${p?.name}`));
      const agent = p.arguments?.agent;
      const task = p.arguments?.task;
      if (!agent || !task) return c.json(err(req.id, -32602, "agent and task are required"));
      const r = await delegateFromRun(runId, agent, task);
      if (!r.ok) {
        return c.json(ok(req.id, { content: [{ type: "text", text: `Delegation failed: ${r.error}` }], isError: true }));
      }
      return c.json(ok(req.id, { content: [{ type: "text", text: `[@${agent} replied]\n${r.result}` }] }));
    }

    case "ping":
      return c.json(ok(req.id, {}));

    default:
      return c.json(err(req.id, -32601, `method not found: ${req.method}`));
  }
});

// 일부 클라이언트는 GET 으로 SSE 스트림을 열려고 한다 — 우리는 단방향이 필요 없음.
mcpRoute.get("/", (c) => c.body(null, 405));
