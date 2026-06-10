// v2-core 사전 — Connections 화면에 필요한 키만. 기능이 늘 때 키도 같이 는다.

export const SUPPORTED_LANGS = ["en", "ko"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const en = {
  "app.title": "loom",
  "app.tagline": "Your CLI agents, one office.",

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
  "conn.test.notReady": "Install and sign in first",

  "common.checking": "Checking…",
} satisfies Record<string, string>;

export type DictKey = keyof typeof en;
export type Dictionary = Record<DictKey, string>;

const ko: Dictionary = {
  "app.title": "loom",
  "app.tagline": "내 CLI 에이전트들을 한 오피스에.",

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
  "conn.test.notReady": "먼저 설치·로그인하세요",

  "common.checking": "확인 중…",
};

export const DICTIONARIES: Record<Lang, Dictionary> = { en, ko };
