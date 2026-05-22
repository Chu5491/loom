import type { AdapterManifest } from "@loom/core";
import { ANTIGRAVITY_PRESET_MODELS } from "./preset-models.js";

// Google AI sparkle — concave-sided 4-point star with the signature
// blue→purple→red→amber gradient used across Google AI brand.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="loom-antigravity-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1C7CFF"/>
      <stop offset="40%" stop-color="#9168C0"/>
      <stop offset="80%" stop-color="#D96570"/>
      <stop offset="100%" stop-color="#F4B400"/>
    </linearGradient>
  </defs>
  <path fill="url(#loom-antigravity-grad)" d="M12 2 C12.6 7.6 16.4 11.4 22 12 C16.4 12.6 12.6 16.4 12 22 C11.4 16.4 7.6 12.6 2 12 C7.6 11.4 11.4 7.6 12 2 Z"/>
</svg>`;

export const antigravityManifest: AdapterManifest = {
  kind: "antigravity",
  displayName: "Antigravity CLI",
  description: "Google's Antigravity CLI (agy). Model is auto-configured by the CLI; extensions via `agy plugin`.",
  icon: "A",
  iconSvg: ICON_SVG,
  docsUrl: "https://github.com/google-gemini/antigravity",
  defaultCommand: "agy",
  defaultConfig: {},
  policyWarnings: [
    {
      level: "warn",
      title: "BYOK required — Google ToS applies",
      body: "Antigravity CLI requires your own API key (`GEMINI_API_KEY` or gcloud credentials). Google's terms of service apply.",
      url: "https://ai.google.dev/gemini-api/terms",
    },
    {
      level: "info",
      title: "MCP plugins are managed by agy CLI",
      body: "Antigravity uses directory-based MCP plugins at `~/.gemini/antigravity-cli/mcp/`. Manage them via `agy plugin import <source>` — Loom's MCP catalog does not auto-sync to agy.",
      url: "https://github.com/google-gemini/antigravity",
    },
  ],
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "Antigravity supports multi-provider models. The CLI uses the interactive picker if not set.",
      options: ANTIGRAVITY_PRESET_MODELS,
      allowCustom: true,
      placeholder: "Auto (interactive picker)",
      group: "basic",
    },
    {
      kind: "boolean",
      key: "dangerouslySkipPermissions",
      label: "Auto-approve all tool calls (--dangerously-skip-permissions)",
      help: "Skips per-tool approval prompts. The CLI will execute any tool without asking.",
      group: "basic",
      danger: true,
    },
    {
      kind: "boolean",
      key: "sandbox",
      label: "Run inside sandbox (--sandbox)",
      help: "Restricts terminal and file/network access for safer execution.",
      group: "basic",
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      help: "Absolute path or alternative binary name. Defaults to `agy` on PATH.",
      placeholder: "agy",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      help: "Appended to the CLI command verbatim.",
      itemPlaceholder: "--log-file /tmp/agy.log",
      group: "advanced",
    },
    {
      kind: "envMap",
      key: "env",
      label: "Environment variables",
      help: "Click a suggestion to add it.",
      group: "advanced",
      suggestions: [
        { key: "GEMINI_API_KEY", description: "Google AI Studio API key", required: true },
        { key: "GOOGLE_API_KEY", description: "Alternative auth (same value)" },
        { key: "GOOGLE_APPLICATION_CREDENTIALS", description: "Path to gcloud service account JSON" },
        { key: "GOOGLE_CLOUD_PROJECT", description: "Project ID for Vertex backend" },
      ],
    },
  ],
};
