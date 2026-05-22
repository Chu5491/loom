import type { ListModelsFn } from "@loom/core";
import { ANTIGRAVITY_PRESET_MODELS } from "./preset-models.js";

export const antigravityListModels: ListModelsFn = async () => ({
  source: "presets",
  models: ANTIGRAVITY_PRESET_MODELS,
  fetchedAt: new Date().toISOString(),
  hint:
    "Showing known Antigravity model catalogue. Pick a model or use Custom…",
});
