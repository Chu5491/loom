// office-as-code — 나의 AI 오피스의 "영혼". 전부 office/ 디렉토리의 파일로
// 정의되고 git 에 커밋된다. id/timestamp 없음 — 파일명/이름이 곧 식별자다.
//
//   office/rules/<name>.md          RuleSpec   (frontmatter 없는 순수 md)
//   office/skills/<name>.md         SkillSpec  (frontmatter: name, description)
//   office/mcp/servers.json         McpServer[]
//   office/agents/<name>.json       AgentSpec
//   office/workflows/<name>.json    WorkflowSpec

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

/** 전담 역할 — 기능별 기본 에이전트 지정. git=커밋 메시지, analyst=프로젝트 분석. */
export type AgentRole = "git" | "analyst";

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
  /** 팀원 위임 허용 — run 에 loom 의 delegate MCP 도구가 실려, 에이전트가 작업 중
   *  다른 office 에이전트를 서브에이전트로 직접 호출할 수 있다(opt-in). */
  delegate?: boolean;
  /** 전담 역할 — UI 의 해당 기능이 이 에이전트를 기본 선택한다.
   *  git=커밋 메시지 생성, analyst=프로젝트 분석 리포트. */
  roles?: AgentRole[];
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

// ── 워크플로우 — 다단계 에이전트 그래프. office/workflows/<name>.json ─────────
// 실행: 수동(사용자 버튼) 또는 트리거(에이전트 run 종료 시 자동/제안).
// 1-hop 하네스(edges.json)를 흡수한 단일 오케스트레이션 개념.

/** 워크플로우 노드 = 한 스텝. prompt 의 {{input}}=실행 입력, {{result}}=직전 결과.
 *  kind "gate" = 휴먼 게이트 — 사람이 승인(success 경로)/거부(fail 경로)할 때까지 정지.
 *  들어오는 엣지가 2개 이상인 노드는 join — 모든 분기가 도착해야 실행되고,
 *  {{result}} 에 분기 결과들이 합쳐져 들어간다. */
export interface WorkflowNode {
  id: string;
  kind?: "agent" | "gate";
  /** kind "gate" 면 무시(빈 문자열 허용). */
  agent: string;
  prompt: string;
  /** 캔버스 좌표 — 편집 UX 의 일부라 정의에 포함(git 커밋). */
  x?: number;
  y?: number;
}

/** 대기 중인 휴먼 게이트 — 서버 인메모리(재시작 시 소실, v1 한계). */
export interface WorkflowGate {
  id: string;
  workflow: string;
  nodeId: string;
  /** 게이트에 도달한 직전 run — 승인 시 다음 스텝의 parentRunId. */
  prevRunId: string | null;
  projectId: string | null;
  threadId: string | null;
  /** 게이트까지 흘러온 결과 — 승인 시 다음 스텝의 {{result}}. */
  result: string;
  createdAt: string;
}
/** 노드 연결 — from 스텝이 on 결과로 끝나면 to 실행. */
export interface WorkflowEdge {
  from: string; // node id
  to: string; // node id
  on: "success" | "fail" | "always";
}
/** 자동/제안 발화 — agent 의 (워크플로우 밖) run 이 on 결과로 끝나면 이 워크플로우를
 *  시작. auto=즉시, ask=UI 제안 버튼. 없으면 수동 실행 전용. */
export interface WorkflowTrigger {
  agent: string;
  on: "success" | "fail" | "changes";
  mode: "auto" | "ask";
}
export interface WorkflowSpec {
  name: string;
  description?: string;
  trigger?: WorkflowTrigger | null;
  /** 시작 노드 id. */
  entry: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** 로드된 오피스 전체 — 파일들을 읽어 메모리에 올린 형태. */
export interface Office {
  rules: RuleSpec[];
  skills: SkillSpec[];
  mcp: import("./types.js").McpServer[];
  agents: AgentSpec[];
  workflows: WorkflowSpec[];
  /** 기능 프롬프트 — git 커밋·분석 같은 내장 기능의 조정 가능한 지침(양식은 코드 고정). */
  prompts: RuleSpec[];
}

// ── 런타임 (data/, gitignore) ────────────────────────────────────────────────

/** CLI 별 출력 포맷의 차이를 흡수한 통합 이벤트. parseEvents 가 만들고,
 *  raw 는 항상 디스크에 보존(Raw는 진실, Parsed는 경험). */
export type OfficeEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; target?: string }
  | { kind: "file"; path: string; action: "edit" | "write" }
  // via "edge" 는 흡수 전 하네스가 영속한 과거 이벤트 호환용.
  | { kind: "handoff"; toAgent: string; via: "edge" | "delegation" | "workflow"; reason?: string }
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

/** 예약 실행 — cron 으로 에이전트 run 을 반복. 프로젝트(머신-로컬)를 가리키므로
 *  기록과 같은 data/(sqlite)에. nextRunAt 은 API 응답에서 croner 가 계산해 채움. */
export interface Schedule {
  id: string;
  name: string;
  /** workflow 가 지정되면 무시 — 워크플로우 스케줄은 그래프가 에이전트를 정한다. */
  agent: string;
  /** 에이전트 스케줄이면 보낼 프롬프트, 워크플로우 스케줄이면 {{input}} 값. */
  prompt: string;
  cron: string;
  /** 지정 시 에이전트 run 대신 이 워크플로우를 시작한다. */
  workflow?: string | null;
  projectId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  nextRunAt?: string | null;
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
  /** 워크플로우 스텝으로 돈 run 이면 워크플로우 이름/노드 id — 진행 보드용. */
  workflow?: string | null;
  node?: string | null;
}
