// 작업 리포트 — 에이전트가 작업 턴 끝에 붙이는 고정 스키마(global 규칙). 전 CLI 가
// "끝에 텍스트로 적는" 방식이라 평문 CLI(agy/devin)도 동일하게 낸다.
export interface WorkReport {
  summary?: string;
  steps?: string[];
  files?: { path: string; action?: string }[];
  decisions?: string[];
  blockers?: string[];
  question?: string | null;
}

// 닫힌 ```loom-report``` 블록(여러 개 가능) + 마지막에 안 닫힌 블록까지 모두 처리.
const FENCE_CLOSED = /```loom-report[^\n]*\n([\s\S]*?)```/g;
const FENCE_OPEN = /```loom-report[^\n]*\n([\s\S]*)$/; // 닫는 ``` 없이 끝난 마지막 블록

function tryParseReport(raw: string): WorkReport | null {
  const t = raw.trim().replace(/```\s*$/, "").trim();
  if (!t) return null;
  const attempt = (s: string): WorkReport | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as WorkReport) : null;
    } catch {
      return null;
    }
  };
  // 일부 CLI 가 펜스 안 JSON 의 따옴표를 \" 로 이스케이프해 내놓는다 — de-escape 재시도.
  return attempt(t) ?? attempt(t.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
}

/** 본문에서 모든 loom-report 펜스를 떼어내고(= raw JSON 이 화면에 새지 않게), 마지막으로
 *  파싱되는 블록을 리포트로 채택. 코드 예시(```json 등)와 충돌하지 않도록 전용 태그 사용.
 *  여러 블록·뒤따르는 잡텍스트·안 닫힌 펜스(verbose/평문 CLI)에도 견고하다. */
export function extractReport(body: string): { body: string; report?: WorkReport } {
  let report: WorkReport | undefined;
  let touched = false;

  let out = body.replace(FENCE_CLOSED, (_m, raw: string) => {
    touched = true;
    const parsed = tryParseReport(raw);
    if (parsed) report = parsed;
    return "";
  });

  const open = FENCE_OPEN.exec(out);
  if (open) {
    touched = true;
    const parsed = tryParseReport(open[1]!);
    if (parsed) report = parsed;
    out = out.slice(0, open.index);
  }

  if (!touched) return { body };
  // 제거 후 남은 외톨이 ``` 펜스 잔재도 정리.
  return { body: out.replace(/```\s*$/, "").trimEnd(), report };
}
