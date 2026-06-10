import type { AdapterSelectOption, ListModelsFn, ListModelsInput } from "@loom/core";
import { CLAUDE_CODE_PRESET_MODELS } from "./preset-models.js";

// Claude Code's CLI has no `models` subcommand, but Anthropic's `/v1/models`
// endpoint lists the account's currently-available models. We read the API key
// from the agent env (adapterConfig.env), fall back to the server's process.env,
// then fall back to curated presets when there's no key / no network.

interface AnthropicModel {
  id: string;
  display_name?: string;
}

function readKey(env?: Record<string, string>): string | undefined {
  return (
    env?.ANTHROPIC_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    undefined
  );
}

function familyOf(id: string): string {
  if (id.includes("opus")) return "Opus";
  if (id.includes("sonnet")) return "Sonnet";
  if (id.includes("haiku")) return "Haiku";
  return "Other";
}

export function parseAnthropicModels(data: AnthropicModel[]): AdapterSelectOption[] {
  return data
    .filter((m) => typeof m.id === "string" && m.id.startsWith("claude"))
    .map((m) => ({
      value: m.id,
      label: m.display_name ?? m.id,
      category: familyOf(m.id),
    }))
    // Date-suffixed ids sort newest-last; reverse so the latest surfaces first.
    .sort((a, b) => b.value.localeCompare(a.value));
}

export const claudeCodeListModels: ListModelsFn = async (input: ListModelsInput) => {
  const now = new Date().toISOString();
  const key = readKey(input.env);
  if (!key) {
    return {
      source: "presets",
      models: CLAUDE_CODE_PRESET_MODELS,
      fetchedAt: now,
      hint: "Set ANTHROPIC_API_KEY (agent env or shell) to fetch live models — showing presets.",
    };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        source: "error",
        models: CLAUDE_CODE_PRESET_MODELS,
        fetchedAt: now,
        error: `HTTP ${res.status}`,
        hint: "Anthropic /v1/models failed — using presets. Check the API key.",
      };
    }
    const json = (await res.json()) as { data?: AnthropicModel[] };
    const models = parseAnthropicModels(json.data ?? []);
    if (models.length === 0) {
      return {
        source: "presets",
        models: CLAUDE_CODE_PRESET_MODELS,
        fetchedAt: now,
        hint: "Anthropic API returned no Claude models — using presets.",
      };
    }
    return {
      source: "live",
      models,
      fetchedAt: now,
      hint: `${models.length} models from Anthropic /v1/models.`,
    };
  } catch (err) {
    return {
      source: "error",
      models: CLAUDE_CODE_PRESET_MODELS,
      fetchedAt: now,
      error: (err as Error).message,
      hint: "Anthropic /v1/models failed — using presets.",
    };
  }
};
