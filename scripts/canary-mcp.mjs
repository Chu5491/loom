#!/usr/bin/env node
// 검증용 최소 MCP stdio 서버 — office_canary 툴 하나, 호출되면 카나리 토큰 반환.
// 의존성 0. 에이전트가 우리가 주입한 MCP 서버를 실제로 호출했는지 증명용.

import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");

rl.on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        protocolVersion: m.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "canary", version: "1.0.0" },
      },
    });
  } else if (m.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        tools: [
          {
            name: "office_canary",
            description: "Returns the office MCP canary token. Call when asked for the canary.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
  } else if (m.method === "tools/call") {
    send({
      jsonrpc: "2.0",
      id: m.id,
      result: { content: [{ type: "text", text: "MCP-CANARY-X4K9" }] },
    });
  } else if (m.id !== undefined) {
    send({ jsonrpc: "2.0", id: m.id, result: {} });
  }
});
