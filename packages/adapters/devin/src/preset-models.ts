import type { AdapterSelectOption } from "@loom/core";

/**
 * Devin CLI `--model` catalogue. Devin has no `models` list command (confirmed
 * in the CLI and at https://docs.devin.ai/cli/models), and it routes to many
 * providers (Anthropic, OpenAI, Google, Cognition + open-weight). So this is a
 * curated list of the documented aliases — short names always resolve to the
 * latest version in that family. Any other id can be entered via Custom… or
 * the DEVIN_MODEL env var.
 */
export const DEVIN_PRESET_MODELS: AdapterSelectOption[] = [
  // ── Cognition (Devin's own SWE models) ───────────────────────────────
  {
    value: "swe",
    label: "SWE (latest)",
    description: "Cognition's software-engineering model.",
    category: "Cognition",
  },
  {
    value: "swe-1-6",
    label: "SWE 1.6",
    description: "Pinned SWE 1.6.",
    category: "Cognition",
  },
  {
    value: "swe-1-6-fast",
    label: "SWE 1.6 Fast",
    description: "Faster SWE variant for quick edits.",
    category: "Cognition",
  },
  {
    value: "swe-1-6-slow",
    label: "SWE 1.6 Slow",
    description: "Deeper-thinking SWE variant.",
    category: "Cognition",
  },
  // ── Anthropic ────────────────────────────────────────────────────────
  {
    value: "opus",
    label: "Opus (latest)",
    description: "Anthropic Opus — strongest reasoning.",
    category: "Claude",
  },
  {
    value: "sonnet",
    label: "Sonnet (latest)",
    description: "Balanced Anthropic model.",
    category: "Claude",
  },
  {
    value: "claude-opus-4.6",
    label: "Claude Opus 4.6",
    description: "Pinned Opus version.",
    category: "Claude",
  },
  {
    value: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    description: "Pinned Sonnet version.",
    category: "Claude",
  },
  // ── OpenAI ───────────────────────────────────────────────────────────
  {
    value: "gpt",
    label: "GPT (latest)",
    description: "OpenAI flagship.",
    category: "OpenAI",
  },
  {
    value: "codex",
    label: "Codex",
    description: "OpenAI Codex routing.",
    category: "OpenAI",
  },
  // ── Google ───────────────────────────────────────────────────────────
  {
    value: "gemini",
    label: "Gemini (latest)",
    description: "Google Gemini.",
    category: "Google",
  },
  // ── Open weight ──────────────────────────────────────────────────────
  {
    value: "kimi",
    label: "Kimi",
    description: "Open-source (Moonshot) model.",
    category: "Open",
  },
  {
    value: "glm",
    label: "GLM",
    description: "Open-source (Zhipu) model.",
    category: "Open",
  },
];
