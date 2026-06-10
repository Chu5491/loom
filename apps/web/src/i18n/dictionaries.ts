// v2-core 사전 — Connections 화면에 필요한 키만. 기능이 늘 때 키도 같이 는다.

export const SUPPORTED_LANGS = ["en", "ko"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const en = {
  "app.title": "loom",
  "app.tagline": "Your CLI agents, one office.",

  "nav.connections": "Connections",
  "nav.office": "Office",

  "office.title": "Office",
  "office.subtitle": "Your rules, skills, agents and MCP — defined here, committed to git. No CLI roots touched.",
  "office.section.rules": "Rules",
  "office.section.skills": "Skills",
  "office.section.agents": "Agents",
  "office.section.mcp": "MCP",
  "office.new": "New",
  "office.save": "Save",
  "office.saving": "Saving…",
  "office.empty": "Nothing here yet — add one.",
  "office.namePlaceholder": "name (a-z, 0-9, -, _)",
  "office.deleteConfirm": "Delete \"{name}\"?",
  "office.skill.desc": "Short description (when to use this skill)",
  "office.agent.adapter": "CLI adapter",
  "office.agent.model": "Model",
  "office.agent.prompt": "Instruction prompt",
  "office.agent.rules": "Rules",
  "office.agent.skills": "Skills",
  "office.agent.mcp": "MCP servers",
  "office.mcp.hint": "MCP servers as a JSON array. Put secrets as \"${ENV_NAME}\" references, never literals.",

  "conn.title": "Connections",
  "conn.subtitle": "Every CLI agent on this machine — discovered, connected, tested.",
  "conn.refreshAll": "Refresh all",

  "conn.binary.installed": "Installed",
  "conn.binary.missing": "Not installed",
  "conn.auth.authenticated": "Authenticated",
  "conn.auth.unauthenticated": "Not signed in",
  "conn.auth.unknown": "Auth unknown",

  "conn.models.title": "Models",
  "conn.models.live": "live",
  "conn.models.presets": "presets",
  "conn.models.error": "error",
  "conn.models.refresh": "Refresh",
  "conn.models.empty": "No models reported.",
  "conn.models.showAll": "Show all {count}",
  "conn.models.showLess": "Show less",

  "conn.test.run": "Run connection test",
  "conn.test.running": "Testing…",
  "conn.test.ok": "Connected — replied in {sec}s",
  "conn.test.fail": "Test failed",
  "conn.test.timeout": "Timed out (30s) — the CLI may be waiting on a model or login. Try setting a default model.",
  "conn.test.notReady": "Install and sign in first",

  "common.checking": "Checking…",
} satisfies Record<string, string>;

export type DictKey = keyof typeof en;
export type Dictionary = Record<DictKey, string>;

const ko: Dictionary = {
  "app.title": "loom",
  "app.tagline": "내 CLI 에이전트들을 한 오피스에.",

  "nav.connections": "연결",
  "nav.office": "오피스",

  "office.title": "오피스",
  "office.subtitle": "규약·스킬·에이전트·MCP를 여기서 정의하고 git에 커밋합니다. CLI root는 건드리지 않아요.",
  "office.section.rules": "규약",
  "office.section.skills": "스킬",
  "office.section.agents": "에이전트",
  "office.section.mcp": "MCP",
  "office.new": "새로 추가",
  "office.save": "저장",
  "office.saving": "저장 중…",
  "office.empty": "아직 없어요 — 하나 추가하세요.",
  "office.namePlaceholder": "이름 (a-z, 0-9, -, _)",
  "office.deleteConfirm": "\"{name}\"을(를) 삭제할까요?",
  "office.skill.desc": "짧은 설명 (언제 쓰는 스킬인지)",
  "office.agent.adapter": "CLI 어댑터",
  "office.agent.model": "모델",
  "office.agent.prompt": "지시 프롬프트",
  "office.agent.rules": "규약",
  "office.agent.skills": "스킬",
  "office.agent.mcp": "MCP 서버",
  "office.mcp.hint": "MCP 서버를 JSON 배열로. secret은 \"${ENV_NAME}\" 참조로 두고 리터럴 금지.",

  "conn.title": "연결",
  "conn.subtitle": "이 머신의 모든 CLI 에이전트 — 발견하고, 연결하고, 테스트합니다.",
  "conn.refreshAll": "전체 새로고침",

  "conn.binary.installed": "설치됨",
  "conn.binary.missing": "미설치",
  "conn.auth.authenticated": "인증됨",
  "conn.auth.unauthenticated": "로그인 필요",
  "conn.auth.unknown": "인증 미확인",

  "conn.models.title": "모델",
  "conn.models.live": "라이브",
  "conn.models.presets": "프리셋",
  "conn.models.error": "오류",
  "conn.models.refresh": "새로고침",
  "conn.models.empty": "보고된 모델이 없어요.",
  "conn.models.showAll": "전체 {count}개 보기",
  "conn.models.showLess": "접기",

  "conn.test.run": "연동 테스트 실행",
  "conn.test.running": "테스트 중…",
  "conn.test.ok": "연결됨 — {sec}초 만에 응답",
  "conn.test.fail": "테스트 실패",
  "conn.test.timeout": "타임아웃(30초) — CLI가 모델 선택이나 로그인을 기다리는 중일 수 있어요. 기본 모델을 설정해보세요.",
  "conn.test.notReady": "먼저 설치·로그인하세요",

  "common.checking": "확인 중…",
};

export const DICTIONARIES: Record<Lang, Dictionary> = { en, ko };
