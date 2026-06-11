// office-as-code — 나의 AI 오피스의 "영혼". 전부 office/ 디렉토리의 파일로
// 정의되고 git 에 커밋된다. id/timestamp 없음 — 파일명/이름이 곧 식별자다.
//
//   office/rules/<name>.md          RuleSpec   (frontmatter 없는 순수 md)
//   office/skills/<name>.md         SkillSpec  (frontmatter: name, description)
//   office/mcp/servers.json         McpServer[]
//   office/agents/<name>.json       AgentSpec
//   office/harness/edges.json       HarnessEdge[]

import type { AdapterConfig, AdapterKind } from "./types.js";

/** 규약 — 에이전트 프롬프트 앞에 붙는 always-on 컨텍스트. name = 파일명 stem. */
export interface RuleSpec {
  name: string;
  body: string;
}

/** 스킬 — 필요할 때 참조되는 컨텍스트 블롭. frontmatter 에 name·description.
 *  단일 `<name>.md` 또는 폴더 `<name>/SKILL.md` + 딸린 파일(references/스크립트). */
export interface SkillSpec {
  name: string;
  description: string;
  body: string;
  /** 폴더 스킬의 딸린 파일들(SKILL.md 제외, 폴더 기준 상대경로). 단일 파일이면 빈 배열. */
  files?: string[];
}

/** 에이전트 = CLI + 모델 + 어떤 rules/skills/mcp 를 끌어올지. name = @mention 핸들. */
export interface AgentSpec {
  name: string;
  adapter: AdapterKind;
  /** 표시용 라벨. 없으면 name 사용. */
  label?: string;
  /** UI 색상 키(에이전트 구분). 없으면 name 해시로 자동 배정. */
  color?: string;
  model?: string;
  /** 추론 강도(성능 다이얼). high=깊게/느림, low=빠름/얕음. 어댑터가 지원하면 반영. */
  reasoning?: "high" | "medium" | "low";
  /** 권한 모드. default=매번 확인, acceptEdits=편집 자동승인, bypass=전부 건너뜀(위험). */
  permission?: "default" | "acceptEdits" | "bypass";
  /** 시스템/지시 프롬프트 — 매 run 의 user 입력 앞에 붙는다. */
  prompt?: string;
  /** 포함할 rule 이름들. */
  rules?: string[];
  /** 포함할 skill 이름들(loadout 으로 디스크에 펼침, 프롬프트엔 인덱스만). */
  skills?: string[];
  /** 호출 허용할 mcp 서버 이름들. */
  mcp?: string[];
  /** 어댑터별 추가 설정(command/env/extraArgs/위험 토글 등). */
  config?: AdapterConfig;
}

export type HarnessTrigger = "on_success" | "on_fail" | "on_changes" | "manual";
export type HarnessMode = "ask" | "auto";

/** 핸드오프 규칙 — from 의 run 이 trigger 로 끝나면 to 로 라우팅. */
export interface HarnessEdge {
  from: string; // agent name
  to: string; // agent name
  trigger: HarnessTrigger;
  mode: HarnessMode;
  /** 발화 시 to 에게 보낼 지시문. carryResult 만으로도 내용이 생긴다. */
  prompt?: string;
  /** from 의 결과를 마크된 블록으로 to 프롬프트에 실어보낼지(자동주입 금지: opt-in). */
  carryResult?: boolean;
}

/** 로드된 오피스 전체 — 파일들을 읽어 메모리에 올린 형태. */
export interface Office {
  rules: RuleSpec[];
  skills: SkillSpec[];
  mcp: import("./types.js").McpServer[];
  agents: AgentSpec[];
  edges: HarnessEdge[];
}

// ── 런타임 (data/, gitignore) ────────────────────────────────────────────────

/** CLI 별 출력 포맷의 차이를 흡수한 통합 이벤트. parseEvents 가 만들고,
 *  raw 는 항상 디스크에 보존(Raw는 진실, Parsed는 경험). */
export type OfficeEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; target?: string }
  | { kind: "file"; path: string; action: "edit" | "write" }
  | { kind: "handoff"; toAgent: string; via: "edge" | "delegation" }
  | { kind: "result"; text: string; costUsd?: number; sessionId?: string }
  | { kind: "error"; message: string };

/** 등록된 로컬 작업 디렉토리. 머신별 경로라 휴대 안 됨 → data/(gitignore)에 기록.
 *  office(전역 공유 팀)와 분리: 프로젝트 = "팀이 일할 곳", run/스레드의 cwd. */
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  /** 대시보드 통계 — 목록 API 가 채워줌(단건/생성 응답엔 없을 수 있음). */
  threadCount?: number;
  lastRunAt?: string | null;
}

/** 대화 스레드 — 같은 스레드의 연속 턴은 CLI 세션을 resume 해 맥락이 이어진다.
 *  기록이므로 data/(sqlite)에. 이름은 첫 프롬프트에서 파생. */
export interface Thread {
  id: string;
  name: string;
  projectId: string | null;
  createdAt: string;
}

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface RunInfo {
  id: string;
  /** 실행한 에이전트 이름. */
  agent: string;
  prompt: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  /** 하네스 엣지가 자동 발화시킨 자식이면 부모 run id. 사용자 시작이면 null.
   *  핸드오프 표시 + hop 깊이 측정(무한루프 방어)에 쓰인다. */
  parentRunId: string | null;
  /** 어느 프로젝트(작업 디렉토리)에서 돌았나. 미지정이면 null(office 홈). */
  projectId: string | null;
  /** 어느 대화 스레드에 속하나. 스레드 안에서 세션이 이어진다. */
  threadId: string | null;
  /** 이 run 의 비용(USD). CLI 가 보고할 때만(claude 등), 아니면 null. */
  costUsd: number | null;
}
