import type { Dictionary, Lang } from "./dictionaries.js";

// 어댑터 매니페스트(필드 라벨, 옵션, 설명 등)에 대한 다국어 사전.
// `dictionaries.ts`가 비대해지지 않도록 분리함. lib/adapterText.ts의 헬퍼가
// `adapter.<kind>.field.<key>` 형태의 키로 조회하고, 없으면 매니페스트의
// 영문 원본으로 폴백.

const en = {
  // claude-code
  "adapter.claude-code.description":
    "Anthropic's official CLI for Claude. Strong for engineering, refactor, and tool-use.",
  "adapter.claude-code.field.model": "Model",
  "adapter.claude-code.field.model.help":
    "Grouped by family. Pick an alias for auto-latest, or use Custom… for any model id.",
  "adapter.claude-code.field.effort": "Reasoning effort",
  "adapter.claude-code.field.effort.help": "Higher = slower but more thorough.",
  "adapter.claude-code.field.effort.option.": "Default",
  "adapter.claude-code.field.effort.option.low": "Low",
  "adapter.claude-code.field.effort.option.medium": "Medium",
  "adapter.claude-code.field.effort.option.high": "High",
  "adapter.claude-code.field.effort.option.xhigh": "Extra high",
  "adapter.claude-code.field.effort.option.max": "Max",
  "adapter.claude-code.field.outputFormat": "Output format",
  "adapter.claude-code.field.outputFormat.help":
    "stream-json gives parsed events in the UI; text returns raw text only.",
  "adapter.claude-code.field.outputFormat.option.stream-json": "stream-json (recommended)",
  "adapter.claude-code.field.outputFormat.option.json": "json (single result)",
  "adapter.claude-code.field.outputFormat.option.text": "text",
  "adapter.claude-code.field.dangerouslySkipPermissions": "Skip all permission checks",
  "adapter.claude-code.field.dangerouslySkipPermissions.help":
    "Bypass Claude Code's tool approval prompts. Only enable for trusted, sandboxed environments — Claude can run any tool without asking.",
  "adapter.claude-code.field.addDirs": "Additional directories",
  "adapter.claude-code.field.addDirs.help":
    "Extra paths Claude Code can read. Equivalent to repeated --add-dir.",
  "adapter.claude-code.field.command": "Command override",
  "adapter.claude-code.field.command.help":
    "Absolute path or alternative binary name. Defaults to `claude` on PATH.",
  "adapter.claude-code.field.extraArgs": "Extra args",
  "adapter.claude-code.field.extraArgs.help": "Appended to the CLI command verbatim.",
  "adapter.claude-code.field.env": "Environment variables",
  "adapter.claude-code.field.env.help":
    "Passed to the spawned process. Click a suggestion to add it.",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_API_KEY": "Anthropic API key",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_AUTH_TOKEN": "Alternative auth token",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_BASE_URL":
    "Custom API endpoint (proxies, gateways)",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_MODEL": "Pin a default model via env",

  // codex
  "adapter.codex.description":
    "OpenAI's coding agent CLI (`codex exec`). Strong on code edits.",
  "adapter.codex.field.model": "Model",
  "adapter.codex.field.model.help":
    "Grouped by family. Reasoning (o-series) needs Pro plan or API. Use Custom… for any other id.",
  "adapter.codex.field.reasoningEffort": "Reasoning effort",
  "adapter.codex.field.reasoningEffort.help":
    "Applies to o-series models. Higher = slower but more thorough.",
  "adapter.codex.field.reasoningEffort.option.": "Default",
  "adapter.codex.field.reasoningEffort.option.low": "Low",
  "adapter.codex.field.reasoningEffort.option.medium": "Medium",
  "adapter.codex.field.reasoningEffort.option.high": "High",
  "adapter.codex.field.search": "Enable web search",
  "adapter.codex.field.search.help":
    "Adds --search to allow codex to perform web lookups.",
  "adapter.codex.field.dangerouslyBypassApprovalsAndSandbox":
    "Bypass all approvals and sandbox",
  "adapter.codex.field.dangerouslyBypassApprovalsAndSandbox.help":
    "Skips every approval prompt and sandbox restriction. Codex can read, write, and execute anything.",
  "adapter.codex.field.cd": "Working directory override (--cd)",
  "adapter.codex.field.cd.help":
    "Tells codex which directory it operates in. Distinct from the spawn cwd.",
  "adapter.codex.field.command": "Command override",
  "adapter.codex.field.extraArgs": "Extra args",
  "adapter.codex.field.env": "Environment variables",
  "adapter.codex.field.env.help": "Click a suggestion to add it.",
  "adapter.codex.field.env.suggestion.OPENAI_API_KEY": "OpenAI API key",
  "adapter.codex.field.env.suggestion.OPENAI_BASE_URL":
    "Custom API endpoint (Azure, proxies)",
  "adapter.codex.field.env.suggestion.OPENAI_ORG_ID": "Organization id for billing",
  "adapter.codex.field.env.suggestion.CODEX_HOME": "Override codex config dir",

  // gemini
  "adapter.gemini.description":
    "Google's Gemini CLI. Strong on long-context reading and multi-modal.",
  "adapter.gemini.field.model": "Model",
  "adapter.gemini.field.model.help":
    "Use Custom… for previews or any model id not in the list.",
  "adapter.gemini.field.command": "Command override",
  "adapter.gemini.field.extraArgs": "Extra args",
  "adapter.gemini.field.env": "Environment variables",
  "adapter.gemini.field.env.suggestion.GEMINI_API_KEY": "Gemini API key",
  "adapter.gemini.field.env.suggestion.GOOGLE_API_KEY": "Alternative key name",
  "adapter.gemini.field.env.suggestion.GOOGLE_GENAI_USE_VERTEXAI":
    "Switch to Vertex AI backend",

  // opencode
  "adapter.opencode.description":
    "OpenCode CLI — open-source coding agent runtime.",
  "adapter.opencode.field.model": "Model",
  "adapter.opencode.field.command": "Command override",
  "adapter.opencode.field.extraArgs": "Extra args",
  "adapter.opencode.field.env": "Environment variables",

  // devin
  "adapter.devin.description":
    "Cognition's Devin — a fast, minimal agent in your terminal and the cloud.",
  "adapter.devin.field.model": "Model",
  "adapter.devin.field.model.help":
    "Devin routes to the chosen model. Leave empty for Devin's default, or use Custom….",
  "adapter.devin.field.dangerouslySkipPermissions":
    "Auto-approve all tools (dangerous)",
  "adapter.devin.field.dangerouslySkipPermissions.help":
    "Default 'auto' approves read-only tools. Enable to auto-approve writes/execs too — trusted dirs only.",
  "adapter.devin.field.command": "Command override",
  "adapter.devin.field.extraArgs": "Extra args",
  "adapter.devin.field.env": "Environment variables",
} satisfies Record<string, string>;

export type AdapterDictKey = keyof typeof en;

const ko: Record<AdapterDictKey, string> = {
  // claude-code
  "adapter.claude-code.description":
    "Anthropic의 공식 Claude CLI. 엔지니어링, 리팩토링, 도구 사용에 강합니다.",
  "adapter.claude-code.field.model": "모델",
  "adapter.claude-code.field.model.help":
    "패밀리별로 묶여 있습니다. 자동 최신 별칭을 고르거나 'Custom…'으로 임의 모델 id를 입력하세요.",
  "adapter.claude-code.field.effort": "추론 강도",
  "adapter.claude-code.field.effort.help": "높을수록 느리지만 더 꼼꼼합니다.",
  "adapter.claude-code.field.effort.option.": "기본",
  "adapter.claude-code.field.effort.option.low": "낮음",
  "adapter.claude-code.field.effort.option.medium": "보통",
  "adapter.claude-code.field.effort.option.high": "높음",
  "adapter.claude-code.field.effort.option.xhigh": "매우 높음",
  "adapter.claude-code.field.effort.option.max": "최대",
  "adapter.claude-code.field.outputFormat": "출력 형식",
  "adapter.claude-code.field.outputFormat.help":
    "stream-json은 UI에 파싱된 이벤트를 표시하고, text는 원시 텍스트만 반환합니다.",
  "adapter.claude-code.field.outputFormat.option.stream-json": "stream-json (권장)",
  "adapter.claude-code.field.outputFormat.option.json": "json (단일 결과)",
  "adapter.claude-code.field.outputFormat.option.text": "text",
  "adapter.claude-code.field.dangerouslySkipPermissions": "모든 권한 검사 우회",
  "adapter.claude-code.field.dangerouslySkipPermissions.help":
    "Claude Code의 도구 승인 프롬프트를 우회합니다. 신뢰할 수 있는 샌드박스 환경에서만 사용하세요 — Claude가 어떤 도구든 묻지 않고 실행할 수 있습니다.",
  "adapter.claude-code.field.addDirs": "추가 디렉토리",
  "adapter.claude-code.field.addDirs.help":
    "Claude Code가 읽을 수 있는 추가 경로. --add-dir 반복과 동일.",
  "adapter.claude-code.field.command": "명령 재정의",
  "adapter.claude-code.field.command.help":
    "절대 경로 또는 다른 바이너리 이름. 기본값은 PATH의 `claude`.",
  "adapter.claude-code.field.extraArgs": "추가 인자",
  "adapter.claude-code.field.extraArgs.help": "CLI 명령 뒤에 그대로 덧붙입니다.",
  "adapter.claude-code.field.env": "환경 변수",
  "adapter.claude-code.field.env.help":
    "프로세스에 전달됩니다. 제안을 클릭해 추가하세요.",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_API_KEY": "Anthropic API 키",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_AUTH_TOKEN": "대체 인증 토큰",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_BASE_URL":
    "사용자 지정 API 엔드포인트 (프록시, 게이트웨이)",
  "adapter.claude-code.field.env.suggestion.ANTHROPIC_MODEL": "환경 변수로 기본 모델 고정",

  // codex
  "adapter.codex.description":
    "OpenAI의 코딩 에이전트 CLI (`codex exec`). 코드 편집에 강합니다.",
  "adapter.codex.field.model": "모델",
  "adapter.codex.field.model.help":
    "패밀리별로 묶여 있습니다. 추론(o-시리즈)은 Pro 플랜 또는 API 필요. 그 외는 'Custom…'.",
  "adapter.codex.field.reasoningEffort": "추론 강도",
  "adapter.codex.field.reasoningEffort.help":
    "o-시리즈 모델에만 적용. 높을수록 느리지만 더 꼼꼼합니다.",
  "adapter.codex.field.reasoningEffort.option.": "기본",
  "adapter.codex.field.reasoningEffort.option.low": "낮음",
  "adapter.codex.field.reasoningEffort.option.medium": "보통",
  "adapter.codex.field.reasoningEffort.option.high": "높음",
  "adapter.codex.field.search": "웹 검색 활성화",
  "adapter.codex.field.search.help":
    "--search를 추가하여 codex가 웹 조회를 수행하도록 허용.",
  "adapter.codex.field.dangerouslyBypassApprovalsAndSandbox":
    "모든 승인·샌드박스 우회",
  "adapter.codex.field.dangerouslyBypassApprovalsAndSandbox.help":
    "모든 승인 프롬프트와 샌드박스 제한을 건너뜁니다. Codex가 어떤 것이든 읽고, 쓰고, 실행할 수 있습니다.",
  "adapter.codex.field.cd": "작업 디렉토리 재정의 (--cd)",
  "adapter.codex.field.cd.help":
    "codex가 작업할 디렉토리를 지정합니다. 프로세스 spawn cwd와는 다름.",
  "adapter.codex.field.command": "명령 재정의",
  "adapter.codex.field.extraArgs": "추가 인자",
  "adapter.codex.field.env": "환경 변수",
  "adapter.codex.field.env.help": "제안을 클릭해 추가하세요.",
  "adapter.codex.field.env.suggestion.OPENAI_API_KEY": "OpenAI API 키",
  "adapter.codex.field.env.suggestion.OPENAI_BASE_URL":
    "사용자 지정 API 엔드포인트 (Azure, 프록시)",
  "adapter.codex.field.env.suggestion.OPENAI_ORG_ID": "결제용 조직 id",
  "adapter.codex.field.env.suggestion.CODEX_HOME": "codex 설정 디렉토리 재정의",

  // gemini
  "adapter.gemini.description":
    "Google Gemini CLI. 긴 컨텍스트 읽기와 멀티모달에 강합니다.",
  "adapter.gemini.field.model": "모델",
  "adapter.gemini.field.model.help":
    "프리뷰나 목록에 없는 모델 id는 'Custom…'을 사용하세요.",
  "adapter.gemini.field.command": "명령 재정의",
  "adapter.gemini.field.extraArgs": "추가 인자",
  "adapter.gemini.field.env": "환경 변수",
  "adapter.gemini.field.env.suggestion.GEMINI_API_KEY": "Gemini API 키",
  "adapter.gemini.field.env.suggestion.GOOGLE_API_KEY": "대체 키 이름",
  "adapter.gemini.field.env.suggestion.GOOGLE_GENAI_USE_VERTEXAI":
    "Vertex AI 백엔드로 전환",

  // opencode
  "adapter.opencode.description":
    "OpenCode CLI — 오픈소스 코딩 에이전트 런타임.",
  "adapter.opencode.field.model": "모델",
  "adapter.opencode.field.command": "명령 재정의",
  "adapter.opencode.field.extraArgs": "추가 인자",
  "adapter.opencode.field.env": "환경 변수",

  // devin
  "adapter.devin.description":
    "Cognition의 Devin — 터미널과 클라우드에서 도는 빠르고 미니멀한 에이전트.",
  "adapter.devin.field.model": "모델",
  "adapter.devin.field.model.help":
    "Devin이 선택한 모델로 라우팅합니다. 비우면 Devin 기본값, 또는 'Custom…' 사용.",
  "adapter.devin.field.dangerouslySkipPermissions":
    "모든 도구 자동 승인 (위험)",
  "adapter.devin.field.dangerouslySkipPermissions.help":
    "기본 'auto'는 읽기 전용 도구만 자동 승인. 켜면 쓰기·실행도 자동 승인 — 신뢰된 디렉토리에서만.",
  "adapter.devin.field.command": "명령 재정의",
  "adapter.devin.field.extraArgs": "추가 인자",
  "adapter.devin.field.env": "환경 변수",
};

export const ADAPTER_DICTIONARIES: Record<Lang, Dictionary> = { en, ko };
