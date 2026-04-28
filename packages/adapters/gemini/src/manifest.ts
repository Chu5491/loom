import type { AdapterManifest } from "@loom/core";
import { GEMINI_PRESET_MODELS } from "./preset-models.js";

// 4-point sparkle mark — recognizable shape used across Google AI products.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path fill="#4285f4" d="M12 1.5 C12 7 12.5 7.5 18 7.5 C12.5 7.5 12 8 12 13 C12 8 11.5 7.5 6 7.5 C11.5 7.5 12 7 12 1.5 Z"/>
  <path fill="#9b72cb" d="M12 11 C12 16.5 12.5 17 18 17 C12.5 17 12 17.5 12 22.5 C12 17.5 11.5 17 6 17 C11.5 17 12 16.5 12 11 Z"/>
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
      placeholder: "gemini",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
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
