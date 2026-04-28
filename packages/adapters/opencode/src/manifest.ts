import type { AdapterManifest } from "@loom/core";

// Bracket / terminal mark — open source, multi-provider feel.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2.5" y="4" width="19" height="16" rx="2.5" fill="none" stroke="#fb923c" stroke-width="1.8"/>
  <path d="M7 10 L4.5 12 L7 14" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17 10 L19.5 12 L17 14" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10.5 15.5 L13.5 8.5" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round"/>
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
