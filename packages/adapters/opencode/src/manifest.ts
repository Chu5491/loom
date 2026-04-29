import type { AdapterManifest } from "@loom/core";

// SST OpenCode mark — orange tile with stylized angle brackets, evoking
// the project's "</>" CLI vibe.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="4.5" fill="#FB923C"/>
  <path d="M8.5 9 L5.5 12 L8.5 15" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M15.5 9 L18.5 12 L15.5 15" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M13.2 7.8 L10.8 16.2" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`;

export const opencodeManifest: AdapterManifest = {
  kind: "opencode",
  displayName: "OpenCode",
  description: "SST's open-source coding agent. Multi-provider, plugin-friendly.",
  icon: "O",
  iconSvg: ICON_SVG,
  docsUrl: "https://github.com/sst/opencode",
  defaultCommand: "opencode",
  defaultConfig: {
    model: "anthropic/claude-sonnet-4-5",
  },
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "OpenCode uses provider/model format.",
      allowCustom: true,
      group: "basic",
      options: [
        { value: "anthropic/claude-sonnet-4-5", label: "Anthropic — Sonnet 4.5" },
        { value: "anthropic/claude-opus-4-7", label: "Anthropic — Opus 4.7" },
        { value: "anthropic/claude-haiku-4-5-20251001", label: "Anthropic — Haiku 4.5" },
        { value: "openai/gpt-5", label: "OpenAI — GPT-5" },
        { value: "openai/o4-mini", label: "OpenAI — o4-mini" },
        { value: "google/gemini-2.5-pro", label: "Google — Gemini 2.5 Pro" },
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
      placeholder: "opencode",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
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
