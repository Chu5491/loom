import type { AdapterManifest } from "@loom/core";
import { GEMINI_PRESET_MODELS } from "./preset-models.js";

// Google Gemini sparkle — concave-sided 4-point star painted with the
// signature blue→purple→red→amber gradient used across Google AI brand.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="loom-gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1C7CFF"/>
      <stop offset="40%" stop-color="#9168C0"/>
      <stop offset="80%" stop-color="#D96570"/>
      <stop offset="100%" stop-color="#F4B400"/>
    </linearGradient>
  </defs>
  <path fill="url(#loom-gemini-grad)" d="M12 2 C12.6 7.6 16.4 11.4 22 12 C16.4 12.6 12.6 16.4 12 22 C11.4 16.4 7.6 12.6 2 12 C7.6 11.4 11.4 7.6 12 2 Z"/>
</svg>`;

export const geminiManifest: AdapterManifest = {
  kind: "gemini",
  displayName: "Gemini CLI",
  description: "Google's official Gemini CLI. Multimodal-friendly, large context.",
  icon: "G",
  iconSvg: ICON_SVG,
  docsUrl: "https://github.com/google-gemini/gemini-cli",
  defaultCommand: "gemini",
  defaultConfig: {
    model: "gemini-2.5-pro",
    outputFormat: "stream-json",
  },
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "Grouped by generation. Use Custom… for any other model id.",
      allowCustom: true,
      group: "basic",
      options: GEMINI_PRESET_MODELS,
    },
    {
      kind: "select",
      key: "outputFormat",
      label: "Output format",
      help: "stream-json enables structured event parsing. text is plain terminal output.",
      group: "basic",
      options: [
        { value: "stream-json", label: "stream-json (recommended)" },
        { value: "text", label: "text" },
      ],
    },
    {
      kind: "boolean",
      key: "yolo",
      label: "Auto-approve all tool calls (--approval-mode yolo)",
      help: "Skips per-tool approval prompts. Gemini will execute any tool without asking.",
      group: "basic",
      danger: true,
    },
    {
      kind: "boolean",
      key: "sandbox",
      label: "Run inside Gemini's sandbox",
      help: "If your gemini CLI was built with sandbox support, restricts file/network access.",
      group: "basic",
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      help: "Absolute path or alternative binary name. Defaults to `gemini` on PATH.",
      placeholder: "gemini",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      help: "Appended to the CLI command verbatim.",
      itemPlaceholder: "--debug",
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
