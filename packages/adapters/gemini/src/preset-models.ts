import type { AdapterSelectOption } from "@loom/core";

/**
 * Gemini CLI model picker — flat list, ordered by capability.
 *
 * Source: https://ai.google.dev/gemini-api/docs/models
 *         https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/model.md
 */
export const GEMINI_PRESET_MODELS: AdapterSelectOption[] = [
  {
    value: "gemini-3-pro-preview",
    label: "Gemini 3 Pro (preview)",
    description: "Top reasoning, current frontier.",
  },
  {
    value: "gemini-3-flash-preview",
    label: "Gemini 3 Flash (preview)",
    description: "Gemini 3 fast tier.",
  },
  {
    value: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Strongest 2.5-generation.",
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Fast, balanced cost.",
  },
  {
    value: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    description: "Fastest, cheapest.",
  },
];
