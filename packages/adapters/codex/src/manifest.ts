import type { AdapterManifest } from "@loom/core";
import { CODEX_PRESET_MODELS } from "./preset-models.js";

// Hex-petal rosette evoking a coding-agent mark.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="#10a37f" fill-opacity="0.85">
    <ellipse cx="12" cy="6" rx="3.2" ry="5"/>
    <ellipse cx="17.2" cy="9" rx="3.2" ry="5" transform="rotate(60 17.2 9)"/>
    <ellipse cx="17.2" cy="15" rx="3.2" ry="5" transform="rotate(120 17.2 15)"/>
    <ellipse cx="12" cy="18" rx="3.2" ry="5"/>
    <ellipse cx="6.8" cy="15" rx="3.2" ry="5" transform="rotate(60 6.8 15)"/>
    <ellipse cx="6.8" cy="9" rx="3.2" ry="5" transform="rotate(120 6.8 9)"/>
  </g>
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
