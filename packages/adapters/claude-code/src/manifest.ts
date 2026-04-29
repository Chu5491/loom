import type { AdapterManifest } from "@loom/core";
import { CLAUDE_CODE_PRESET_MODELS } from "./preset-models.js";

// Friendly Claude robot — terra-cotta rounded body with a tiny antenna,
// two dot eyes, and a soft smile. Reads as "an agent" at a glance.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <line x1="12" y1="6" x2="12" y2="3.5" stroke="#D97757" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="12" cy="2.6" r="1.1" fill="#D97757"/>
  <rect x="3.5" y="6" width="17" height="14" rx="5.5" fill="#D97757"/>
  <circle cx="9" cy="12.5" r="1.5" fill="white"/>
  <circle cx="15" cy="12.5" r="1.5" fill="white"/>
  <path d="M9.2 16 Q12 18 14.8 16" stroke="white" stroke-width="1.6" fill="none" stroke-linecap="round"/>
</svg>`;

export const claudeCodeManifest: AdapterManifest = {
  kind: "claude-code",
  displayName: "Claude Code",
  description:
    "Anthropic's official CLI for Claude. Strong for engineering, refactor, and tool-use.",
  icon: "C",
  iconSvg: ICON_SVG,
  docsUrl: "https://docs.claude.com/en/docs/claude-code/overview",
  defaultCommand: "claude",
  defaultConfig: {
    model: "claude-sonnet-4-5",
    outputFormat: "stream-json",
  },
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "Grouped by family. Pick an alias for auto-latest, or use Custom… for any model id.",
      allowCustom: true,
      group: "basic",
      options: CLAUDE_CODE_PRESET_MODELS,
    },
    {
      kind: "select",
      key: "effort",
      label: "Reasoning effort",
      help: "Higher = slower but more thorough.",
      group: "basic",
      options: [
        { value: "", label: "Default" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra high" },
        { value: "max", label: "Max" },
      ],
    },
    {
      kind: "select",
      key: "outputFormat",
      label: "Output format",
      help: "stream-json gives parsed events in the UI; text returns raw text only.",
      group: "basic",
      options: [
        { value: "stream-json", label: "stream-json (recommended)" },
        { value: "json", label: "json (single result)" },
        { value: "text", label: "text" },
      ],
    },
    {
      kind: "boolean",
      key: "dangerouslySkipPermissions",
      label: "Skip all permission checks",
      help: "Bypass Claude Code's tool approval prompts. Only enable for trusted, sandboxed environments — Claude can run any tool without asking.",
      group: "basic",
      danger: true,
    },
    {
      kind: "stringList",
      key: "addDirs",
      label: "Additional directories",
      help: "Extra paths Claude Code can read. Equivalent to repeated --add-dir.",
      itemPlaceholder: "/path/to/project",
      group: "advanced",
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      help: "Absolute path or alternative binary name. Defaults to `claude` on PATH.",
      placeholder: "claude",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      help: "Appended to the CLI command verbatim.",
      itemPlaceholder: "--mcp-config",
      group: "advanced",
    },
    {
      kind: "envMap",
      key: "env",
      label: "Environment variables",
      help: "Passed to the spawned process. Click a suggestion to add it.",
      group: "advanced",
      suggestions: [
        { key: "ANTHROPIC_API_KEY", description: "Anthropic API key", required: true },
        { key: "ANTHROPIC_AUTH_TOKEN", description: "Alternative auth token" },
        { key: "ANTHROPIC_BASE_URL", description: "Custom API endpoint (proxies, gateways)" },
        { key: "ANTHROPIC_MODEL", description: "Pin a default model via env" },
      ],
    },
  ],
};
