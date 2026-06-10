// run 의 최종 result 텍스트 추출 — CLI 가 stream-json 으로 선언한 마지막
// `type:"result"` 의 텍스트. "다른 에이전트로 넘기기"(수동) 와 하네스 자동
// 발화(carry_result) 양쪽에서 같은 결과를 쓰도록 한 곳에 둔다.

import type { Run } from "@loom/core";
import { readLogFile } from "../log-store.js";

export async function extractRunResultText(run: Run): Promise<string | null> {
  if (!run.logPath) return null;
  const events = await readLogFile(run.logPath).catch(() => []);
  let buffer = "";
  let resultText: string | null = null;
  for (const ev of events) {
    if (ev.kind !== "chunk" || ev.chunk.stream !== "stdout") continue;
    buffer += ev.chunk.data;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (!line) continue;
      try {
        const j = JSON.parse(line) as { type?: string; result?: string };
        if (j.type === "result" && typeof j.result === "string") {
          resultText = j.result;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }
  return resultText;
}
