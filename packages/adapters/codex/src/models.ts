import type { ListModelsFn } from "@loom/core";
import { CODEX_PRESET_MODELS } from "./preset-models.js";

// Codex's CLI doesn't expose a model-list command. We serve OpenAI's official
// catalogue from preset-models.ts and let users use Custom… for anything else.
export const codexListModels: ListModelsFn = async () => ({
  source: "presets",
  models: CODEX_PRESET_MODELS,
  fetchedAt: new Date().toISOString(),
  hint:
    "Codex's CLI has no model-list command. Showing OpenAI's official catalogue — pick by family or use Custom…",
});
