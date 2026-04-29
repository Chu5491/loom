import type { AdapterManifest } from "@loom/core";
import { CLAUDE_CODE_PRESET_MODELS } from "./preset-models.js";

// Anthropic's Claude "spark" mark — 4-pointed terra-cotta asterisk with
// smooth concave curves where the rays meet.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path fill="#D97757" d="M12 1.5 L13.5 8.5 C13.7 9.5 14.5 10.3 15.5 10.5 L22.5 12 L15.5 13.5 C14.5 13.7 13.7 14.5 13.5 15.5 L12 22.5 L10.5 15.5 C10.3 14.5 9.5 13.7 8.5 13.5 L1.5 12 L8.5 10.5 C9.5 10.3 10.3 9.5 10.5 8.5 L12 1.5 Z"/>
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
