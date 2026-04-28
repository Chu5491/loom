import type { ListModelsFn } from "@loom/core";
import { GEMINI_PRESET_MODELS } from "./preset-models.js";

// Gemini CLI doesn't expose a model-list command (only --list-extensions and
// --list-sessions). We serve Google's official catalogue from preset-models.ts
// with Custom… for anything beyond it.
export const geminiListModels: ListModelsFn = async () => ({
  source: "presets",
  models: GEMINI_PRESET_MODELS,
  fetchedAt: new Date().toISOString(),
  hint:
    "Gemini CLI has no model-list command. Showing Google's official catalogue — pick by generation or use Custom…",
});
