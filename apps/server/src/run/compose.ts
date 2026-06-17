// 최종 프롬프트 조립. 자동 주입은 죄 — office 에 명시한 rules·loadout 만,
// 출처를 표시하고 붙인다. 스킬 본문은 loadout 디스크에, 프롬프트엔 인덱스만.

import type { AgentLoadout } from "./loadout.js";

export interface ComposeInput {
  userPrompt: string;
  /** 포함된 rule 들의 본문 (office/rules). 매 턴 동일 prefix → prompt cache 친화. */
  rules: string[];
  /** 에이전트 지시 프롬프트. */
  agentPrompt?: string;
  loadout?: AgentLoadout | null;
  /** 이어가는(resume) 턴인가. true 면 rules·페르소나를 재주입하지 않는다 —
   *  이미 대화 첫 턴에 들어가 있어, 매 턴 다시 보내면 에이전트가 자기소개를
   *  반복한다(검증됨). loadout(경로가 run마다 바뀜)·메모·사용자 입력만 보낸다. */
  resuming?: boolean;
  /** 프로젝트 공유 메모(<project>/.loom/notes.md) — 파일이 있을 때만 경로 안내.
   *  본문은 주입하지 않는다(자동 주입 금지) — 에이전트가 필요할 때 Read. */
  projectNotesPath?: string | null;
  /** 최신 프로젝트 분석 뷰(<project>/.loom/analysis.md) — 다른 CLI 도구가 만든
   *  프로젝트 이해를 이어 읽는 경로. 노트와 같이 경로만 안내, 본문 주입 없음. */
  projectAnalysisPath?: string | null;
}

/** 분리된 프롬프트 — system(안정 prefix: rules+페르소나, 캐시·시스템채널용)과
 *  user(매 run 변동: loadout 경로·프로젝트 기억·사용자 입력). joinPrompt 로 합치면
 *  기존 단일 프롬프트와 100% 동일(순서 보존) — 시스템 채널 없는 CLI 는 무변화. */
export interface ComposedPrompt {
  system: string;
  user: string;
}

export function composePrompt(input: ComposeInput): ComposedPrompt {
  const systemSections: string[] = [];
  const userSections: string[] = [];

  // 시스템(안정 prefix) = rules + 페르소나. resume 턴엔 생략 — 세션에 이미 들어가 있다.
  if (!input.resuming) {
    for (const r of input.rules) {
      const body = r.trim();
      if (body) systemSections.push(`=== Rules ===\n${body}\n=== End Rules ===`);
    }
    const a = input.agentPrompt?.trim();
    if (a) systemSections.push(`=== Agent Instructions ===\n${a}\n=== End Instructions ===`);
  }

  // 유저(매 run 변동) = loadout(경로) + 프로젝트 기억 + 사용자 입력.
  if (input.loadout && (input.loadout.skills.length || input.loadout.mcpServerNames.length || input.loadout.delegate)) {
    userSections.push(renderLoadout(input.loadout));
  }

  if (input.projectNotesPath || input.projectAnalysisPath) {
    const lines = [
      "=== Project Memory ===",
      // 핵심: 팀원은 서로 다른 CLI 라 대화 이력을 공유하지 못한다. 이 파일이 유일한
      // 공유 채널 — 그래서 "읽고 / 없으면 만들고 / 넘기기 전에 적어라"를 명시한다.
      "Shared, persistent context for this project. Your teammates run on different CLIs and CANNOT see each other's chat history — this file is the ONLY channel you share with them. Read it before you start:",
    ];
    if (input.projectNotesPath) {
      lines.push(`- Team notes (read it first; create the file if it doesn't exist yet; append durable notes): ${input.projectNotesPath}`);
    }
    if (input.projectAnalysisPath) {
      lines.push(`- Latest project analysis — structure, stack, risks (read-only, may be from another agent): ${input.projectAnalysisPath}`);
    }
    if (input.projectNotesPath) {
      lines.push("After meaningful work or before handing off, append concise durable notes (decisions, results, gotchas) here so a teammate on another CLI can continue where you left off. Keep entries short.");
    }
    lines.push("=== End Project Memory ===");
    userSections.push(lines.join("\n"));
  }

  userSections.push(input.userPrompt);
  return { system: systemSections.join("\n\n"), user: userSections.join("\n\n") };
}

/** system + user 를 한 프롬프트로 — 시스템 채널 없는 CLI(codex·opencode·antigravity)와
 *  프리뷰용. 기존 composePrompt 출력과 동일한 순서. */
export function joinPrompt(c: ComposedPrompt): string {
  return c.system ? `${c.system}\n\n${c.user}` : c.user;
}

function renderLoadout(l: AgentLoadout): string {
  const lines: string[] = ["=== Loadout ==="];
  lines.push(`Your toolbox lives at: ${l.dir}`);
  lines.push("Read files from this folder on demand — don't load all upfront.");
  if (l.skills.length) {
    lines.push("", `Skills (${l.skills.length}):`);
    for (const s of l.skills) lines.push(`  - ${s.relPath}  ${s.name}${s.blurb ? ` — ${s.blurb}` : ""}`);
  }
  if (l.mcpServerNames.length) {
    // 툴 네이밍은 CLI마다 다름(claude=mcp__server__method, devin/others=서버 고유명).
    // 특정 컨벤션을 강제하지 않고 "사용 가능"만 알린다 — 잘못된 이름 강제가
    // 일부 CLI에서 툴을 못 찾게 만들었음(검증).
    lines.push("", `MCP servers available (${l.mcpServerNames.length}):`);
    for (const n of l.mcpServerNames) lines.push(`  - ${n}  — its tools are available; call them when relevant.`);
  }
  if (l.delegate) {
    // MCP 도구가 없는 CLI 의 위임 경로 — 셸로 브리지 실행. delegate opt-in 시에만 실린다.
    lines.push(
      "",
      "Delegation (this CLI has no MCP tools — use the shell bridge):",
      `  Run: sh ${l.delegate.scriptPath} <teammate> "<complete, self-contained task>"`,
      "  The teammate's reply prints to stdout. Use it to continue your work.",
      `  Teammates: ${l.delegate.teammates.join(", ")}`,
    );
  }
  lines.push(`\nFull index: ${l.readmePath}`, "=== End Loadout ===");
  return lines.join("\n");
}
