import type { AdapterManifest } from "@loom/core";
import { CODEX_PRESET_MODELS } from "./preset-models.js";

// Codex — OpenAI green rounded tile with white curly braces. Distinct
// from the existing six-fold knot (which read as too dense at small
// avatar sizes) and from OpenCode's bracket mark.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="5" fill="#10A37F"/>
  <path d="M10 6 Q7 6 7 9 L7 11 Q7 12 5.5 12 Q7 12 7 13 L7 15 Q7 18 10 18" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14 6 Q17 6 17 9 L17 11 Q17 12 18.5 12 Q17 12 17 13 L17 15 Q17 18 14 18" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const codexManifest: AdapterManifest = {
  kind: "codex",
  displayName: "Codex",
  description: "OpenAI's coding agent CLI (`codex exec`). Strong on code edits.",
  icon: "X",
  iconSvg: ICON_SVG,
  docsUrl: "https://github.com/openai/codex",
  defaultCommand: "codex",
  defaultConfig: {
    model: "gpt-5",
  },
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "Grouped by family. Reasoning (o-series) needs Pro plan or API. Use Custom… for any other id.",
      allowCustom: true,
      group: "basic",
      options: CODEX_PRESET_MODELS,
    },
    {
      kind: "select",
      key: "reasoningEffort",
      label: "Reasoning effort",
      help: "Applies to o-series models. Higher = slower but more thorough.",
      allowCustom: false,
      group: "basic",
      options: [
        { value: "", label: "Default" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
    {
      kind: "boolean",
      key: "search",
      label: "Enable web search",
      help: "Adds --search to allow codex to perform web lookups.",
      group: "basic",
    },
    {
      kind: "boolean",
      key: "dangerouslyBypassApprovalsAndSandbox",
      label: "Bypass all approvals and sandbox",
      help: "Skips every approval prompt and sandbox restriction. Codex can read, write, and execute anything.",
      group: "basic",
      danger: true,
    },
    {
      kind: "string",
      key: "cd",
      label: "Working directory override (--cd)",
      help: "Tells codex which directory it operates in. Distinct from the spawn cwd.",
      placeholder: "/Users/me/repo",
      group: "advanced",
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      placeholder: "codex",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      itemPlaceholder: "-c",
      group: "advanced",
    },
    {
      kind: "envMap",
      key: "env",
      label: "Environment variables",
      help: "Click a suggestion to add it.",
      group: "advanced",
      suggestions: [
        { key: "OPENAI_API_KEY", description: "OpenAI API key", required: true },
        { key: "OPENAI_BASE_URL", description: "Custom API endpoint (Azure, proxies)" },
        { key: "OPENAI_ORG_ID", description: "Organization id for billing" },
        { key: "CODEX_HOME", description: "Override codex config dir" },
      ],
    },
  ],
};
