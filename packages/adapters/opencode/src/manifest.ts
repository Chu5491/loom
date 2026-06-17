import type { AdapterManifest } from "@loom/core";

// OpenCode — SST's signature deep-slate tile with three orange code-line
// stripes evoking a code listing / terminal output. Distinct from
// Codex's curly-brace mark.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="5" fill="#0F172A"/>
  <rect x="6" y="7.5" width="9" height="2" rx="1" fill="#FB923C"/>
  <rect x="6" y="11" width="12" height="2" rx="1" fill="#FB923C"/>
  <rect x="6" y="14.5" width="6" height="2" rx="1" fill="#FB923C"/>
</svg>`;

export const opencodeManifest: AdapterManifest = {
  kind: "opencode",
  displayName: "OpenCode",
  description: "SST's open-source coding agent. Multi-provider, plugin-friendly.",
  icon: "O",
  iconSvg: ICON_SVG,
  docsUrl: "https://github.com/sst/opencode",
  defaultCommand: "opencode",
  // 모델 미지정 = opencode 가 자기 config(~/.config/opencode/opencode.json)의
  // 기본 모델을 쓴다. 특정 프로바이더를 강제하지 않아 "CLI 그대로" 원칙에 맞고,
  // 연동 테스트도 사용자가 실제로 인증한 모델로 돈다.
  defaultConfig: {},
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "provider/model 형식. 비우면 opencode 설정의 기본 모델을 씀. 라이브 목록은 `opencode models`에서.",
      allowCustom: true,
      placeholder: "기본 모델 (opencode 설정)",
      group: "basic",
      options: [],
    },
    {
      kind: "select",
      key: "variant",
      label: "Reasoning effort",
      help: "--variant. 프로바이더별 추론 강도(OpenAI minimal~xhigh, Anthropic high/max, Google low/high). 비우면 모델 기본값.",
      allowCustom: true,
      placeholder: "모델 기본값",
      group: "basic",
      options: [
        { value: "minimal", label: "Minimal" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "xHigh" },
        { value: "max", label: "Max" },
      ],
    },
    {
      kind: "string",
      key: "agent",
      label: "Agent profile",
      help: "OpenCode agent name. Empty = default.",
      placeholder: "build",
      group: "basic",
    },
    {
      kind: "boolean",
      key: "continueSession",
      label: "Continue most recent session",
      help: "Equivalent to --continue. Picks up where the last run left off.",
      group: "basic",
    },
    {
      kind: "string",
      key: "sessionId",
      label: "Resume specific session",
      placeholder: "sess-abc123",
      group: "advanced",
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      help: "Absolute path or alternative binary name. Defaults to `opencode` on PATH.",
      placeholder: "opencode",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      help: "Appended to the CLI command verbatim.",
      itemPlaceholder: "--share",
      group: "advanced",
    },
    {
      kind: "envMap",
      key: "env",
      label: "Environment variables",
      help: "OpenCode talks to whatever providers you've configured. Add the relevant API keys.",
      group: "advanced",
      suggestions: [
        { key: "ANTHROPIC_API_KEY", description: "Required for Claude provider" },
        { key: "OPENAI_API_KEY", description: "Required for OpenAI provider" },
        { key: "GOOGLE_API_KEY", description: "Required for Gemini provider" },
        { key: "GROQ_API_KEY", description: "Required for Groq provider" },
        { key: "MISTRAL_API_KEY", description: "Required for Mistral provider" },
        { key: "XAI_API_KEY", description: "Required for xAI / Grok provider" },
      ],
    },
  ],
};
