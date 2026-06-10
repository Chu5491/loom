import type { ListModelsFn } from "@loom/core";
import { DEVIN_PRESET_MODELS } from "./preset-models.js";

// Devin has no `models list` command; we surface the common --model values.
export const devinListModels: ListModelsFn = async () => ({
  source: "presets",
  models: DEVIN_PRESET_MODELS,
  fetchedAt: new Date().toISOString(),
  hint: "Showing common Devin --model values. Pick one or use Custom…",
});
