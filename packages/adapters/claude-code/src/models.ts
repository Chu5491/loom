import type { ListModelsFn } from "@loom/core";
import { CLAUDE_CODE_PRESET_MODELS } from "./preset-models.js";

// Claude Code's CLI doesn't expose a `claude models` subcommand (the picker is
// interactive only via /model). We serve the curated catalogue from
// preset-models.ts and let users type any model id via the Custom… option.
export const claudeCodeListModels: ListModelsFn = async () => ({
  source: "presets",
  models: CLAUDE_CODE_PRESET_MODELS,
  fetchedAt: new Date().toISOString(),
  hint:
    "Claude Code's CLI has no model-list command. Showing Anthropic's official catalogue — pick by family or use Custom…",
});
