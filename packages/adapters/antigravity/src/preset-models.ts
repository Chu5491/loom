import type { AdapterSelectOption } from "@loom/core";

/**
 * Antigravity CLI model catalogue — preset list from the official picker.
 *
 * agy CLI has no --model flag; model selection is done via the interactive
 * picker or settings.json `model` key. We surface the known catalogue here
 * so the Loom UI can show the dropdown. The actual model id may differ from
 * what the user sees in the picker label.
 *
 * "High / Medium / Low" suffixes refer to the thinking-budget tier.
 */
export const ANTIGRAVITY_PRESET_MODELS: AdapterSelectOption[] = [
  // ── Google Gemini ────────────────────────────────────────────────
  {
    value: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Fast, cost-efficient. High thinking budget.",
    category: "Gemini",
  },
  {
    value: "gemini-3.5-flash:thinking-medium",
    label: "Gemini 3.5 Flash (Medium)",
    description: "Flash with medium thinking budget.",
    category: "Gemini",
  },
  {
    value: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    description: "Balanced capability. High thinking budget.",
    category: "Gemini",
  },
  {
    value: "gemini-3.1-pro:thinking-low",
    label: "Gemini 3.1 Pro (Low)",
    description: "Pro with low thinking budget.",
    category: "Gemini",
  },

  // ── Anthropic Claude ─────────────────────────────────────────────
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 Thinking",
    description: "Anthropic Sonnet via cross-provider routing.",
    category: "Claude",
  },
  {
    value: "claude-opus-4-6",
    label: "Claude Opus 4.6 Thinking",
    description: "Anthropic Opus via cross-provider routing.",
    category: "Claude",
  },

  // ── Open-weight ──────────────────────────────────────────────────
  {
    value: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Open-weight 120B. Medium thinking budget.",
    category: "Open",
  },
];
