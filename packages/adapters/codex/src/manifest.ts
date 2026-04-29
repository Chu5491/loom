import type { AdapterManifest } from "@loom/core";
import { CODEX_PRESET_MODELS } from "./preset-models.js";

// OpenAI's six-fold knot/blossom — the brand mark used across OpenAI
// products including Codex. Black on light, white on dark via currentColor
// where the host element sets text color. Filled in the canonical black.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path fill="currentColor" d="M21.55 10.04a5.45 5.45 0 0 0-.47-4.48 5.52 5.52 0 0 0-5.95-2.65A5.5 5.5 0 0 0 6.83 4.6a5.45 5.45 0 0 0-3.65 2.65 5.52 5.52 0 0 0 .68 6.47 5.45 5.45 0 0 0 .47 4.48 5.52 5.52 0 0 0 5.95 2.65 5.45 5.45 0 0 0 4.1 1.83 5.52 5.52 0 0 0 5.26-3.83 5.45 5.45 0 0 0 3.65-2.65 5.52 5.52 0 0 0-.68-6.47zM13.4 21.07a4.07 4.07 0 0 1-2.61-.95l.13-.07 4.34-2.51a.71.71 0 0 0 .36-.62v-6.13l1.83 1.06v5.07a4.1 4.1 0 0 1-4.05 4.15zm-8.7-3.72a4.05 4.05 0 0 1-.49-2.74l.13.08 4.34 2.51c.22.13.5.13.71 0l5.3-3.06v2.11a.06.06 0 0 1-.03.06l-4.4 2.54a4.1 4.1 0 0 1-5.56-1.5zM3.36 8.53a4.07 4.07 0 0 1 2.13-1.79V11.9a.7.7 0 0 0 .35.61l5.27 3.04-1.83 1.06-4.39-2.54A4.1 4.1 0 0 1 3.36 8.53zm15.07 3.51l-5.3-3.07L14.96 7.9l4.39 2.53a4.09 4.09 0 0 1-.62 7.4v-5.16a.7.7 0 0 0-.3-.62zM20.25 9.6l-.13-.08-4.33-2.52a.71.71 0 0 0-.71 0L9.79 10.07V7.96a.06.06 0 0 1 .02-.06l4.4-2.54a4.1 4.1 0 0 1 6.05 4.24zM8.79 13.06l-1.83-1.06V6.93a4.1 4.1 0 0 1 6.71-3.16l-.12.07L9.21 6.36a.71.71 0 0 0-.36.62zm.99-2.13l2.36-1.36 2.36 1.36v2.72l-2.36 1.36-2.36-1.36z"/>
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
