import type { AdapterSelectOption, ListModelsFn, ListModelsInput } from "@loom/core";
import { CODEX_PRESET_MODELS } from "./preset-models.js";

// Codex's CLI has no model-list command, but OpenAI's `/v1/models` lists the
// account's available models. That list includes a lot of non-chat models
// (embeddings, tts, image, whisper…), so we filter down to the coding/chat
// families. Key comes from the agent env, falling back to process.env.

interface OpenAiModel {
  id: string;
}

function readKey(env?: Record<string, string>): string | undefined {
  return (
    env?.OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

// Keep gpt / o-series / codex / chatgpt; drop everything that isn't a chat or
// coding model so the dropdown isn't flooded with embeddings & media models.
const KEEP = /^(gpt-|o[1-9]|chatgpt-|codex)/i;
const DROP =
  /(embedding|tts|whisper|audio|realtime|transcribe|image|dall-e|moderation|search|babbage|davinci|ada|curie|instruct-0|-vision-preview)/i;

function familyOf(id: string): string {
  if (/^o[1-9]/i.test(id)) return "Reasoning (o-series)";
  if (id.startsWith("codex")) return "Codex";
  if (id.startsWith("gpt-5") || id.startsWith("gpt-4")) return "GPT";
  return "Other";
}

export function filterOpenAiModels(data: OpenAiModel[]): AdapterSelectOption[] {
  return data
    .filter((m) => typeof m.id === "string" && KEEP.test(m.id) && !DROP.test(m.id))
    .map((m) => ({ value: m.id, label: m.id, category: familyOf(m.id) }))
    .sort((a, b) => b.value.localeCompare(a.value));
}

export const codexListModels: ListModelsFn = async (input: ListModelsInput) => {
  const now = new Date().toISOString();
  const key = readKey(input.env);
  if (!key) {
    return {
      source: "presets",
      models: CODEX_PRESET_MODELS,
      fetchedAt: now,
      hint: "Set OPENAI_API_KEY (agent env or shell) to fetch live models — showing presets.",
    };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        source: "error",
        models: CODEX_PRESET_MODELS,
        fetchedAt: now,
        error: `HTTP ${res.status}`,
        hint: "OpenAI /v1/models failed — using presets. Check the API key.",
      };
    }
    const json = (await res.json()) as { data?: OpenAiModel[] };
    const models = filterOpenAiModels(json.data ?? []);
    if (models.length === 0) {
      return {
        source: "presets",
        models: CODEX_PRESET_MODELS,
        fetchedAt: now,
        hint: "OpenAI API returned no coding models — using presets.",
      };
    }
    return {
      source: "live",
      models,
      fetchedAt: now,
      hint: `${models.length} models from OpenAI /v1/models.`,
    };
  } catch (err) {
    return {
      source: "error",
      models: CODEX_PRESET_MODELS,
      fetchedAt: now,
      error: (err as Error).message,
      hint: "OpenAI /v1/models failed — using presets.",
    };
  }
};
