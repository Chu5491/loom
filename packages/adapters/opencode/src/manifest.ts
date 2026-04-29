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
