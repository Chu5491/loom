import type { AdapterSelectOption } from "@loom/core";

/**
 * Codex CLI model picker — flat list, ordered by capability.
 *
 * Source: https://developers.openai.com/codex/models
 */
export const CODEX_PRESET_MODELS: AdapterSelectOption[] = [
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    description: "Newest frontier. ChatGPT login only — not via API key.",
  },
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    description: "Flagship for professional work.",
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Fast, cheap, good for subagents.",
  },
  {
    value: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Coding-specialized.",
  },
  {
    value: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    description: "Real-time iteration. ChatGPT Pro only.",
  },
];
