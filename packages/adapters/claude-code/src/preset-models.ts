import type { AdapterSelectOption } from "@loom/core";

/**
 * Claude Code model picker — flat list, ordered by capability.
 *
 * Sources:
 *   - https://platform.claude.com/docs/en/about-claude/models/overview
 *   - https://code.claude.com/docs/en/model-config
 *
 * The `[1m]` suffix appended to a model id forces the 1M-token context
 * window. Claude Code strips the suffix before sending the model id to the
 * provider. Only Opus 4.7 / Opus 4.6 / Sonnet 4.6 support 1M context.
 *
 * On Max / Team / Enterprise, regular Opus is auto-upgraded to 1M, so the
 * `[1m]` variant matters most on Pro (extra usage) and API.
 */
export const CLAUDE_CODE_PRESET_MODELS: AdapterSelectOption[] = [
  {
    value: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Most capable.",
  },
  {
    value: "claude-opus-4-7[1m]",
    label: "Opus 4.7 1M",
    description: "Opus 4.7 with 1M-token context window.",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Balanced default.",
  },
  {
    value: "claude-sonnet-4-6[1m]",
    label: "Sonnet 4.6 1M",
    description: "Sonnet 4.6 with 1M-token context window.",
  },
  {
    value: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Previous Opus.",
  },
  {
    value: "claude-opus-4-6[1m]",
    label: "Opus 4.6 1M",
    description: "Opus 4.6 with 1M-token context window.",
  },
  {
    value: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    description: "Legacy. 200k context.",
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    description: "Fastest, cheapest. 200k only.",
  },
];
