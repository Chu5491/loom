import { spawnCapture, stripAnsi } from "@loom/adapter-utils";
import type { AdapterSelectOption, ListModelsFn } from "@loom/core";

const FALLBACK_PRESETS: AdapterSelectOption[] = [
  { value: "anthropic/claude-sonnet-4-5", label: "Anthropic — Sonnet 4.5" },
  { value: "anthropic/claude-opus-4-7", label: "Anthropic — Opus 4.7" },
  { value: "openai/gpt-5", label: "OpenAI — GPT-5" },
  { value: "google/gemini-2.5-pro", label: "Google — Gemini 2.5 Pro" },
];

/** Parses opencode's `provider/model` lines into select options. */
function parseModelLines(stdout: string): AdapterSelectOption[] {
  const seen = new Set<string>();
  const out: AdapterSelectOption[] = [];
  for (const line of stripAnsi(stdout).split("\n")) {
    const trimmed = line.trim();
    // Each model line has the form `provider/model` — skip headers and noise.
    if (!trimmed || !/^[\w.-]+\/[\w./:+-]+$/.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    const slash = trimmed.indexOf("/");
    const provider = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1);
    out.push({
      value: trimmed,
      label: `${formatProvider(provider)} — ${model}`,
    });
  }
  return out.sort((a, b) => a.value.localeCompare(b.value));
}

function formatProvider(p: string): string {
  if (p === "openai") return "OpenAI";
  if (p === "anthropic") return "Anthropic";
  if (p === "google" || p === "gemini") return "Google";
  if (p === "xai") return "xAI";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export const opencodeListModels: ListModelsFn = async (input) => {
  const command = input.command ?? "opencode";
  const now = new Date().toISOString();

  const result = await spawnCapture(command, ["models"], { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    return {
      source: "error",
      models: FALLBACK_PRESETS,
      fetchedAt: now,
      error: result.stderr.trim().slice(0, 200) || `exit ${result.exitCode}`,
      hint: "`opencode models` failed — using presets. Make sure opencode is installed and authenticated.",
    };
  }

  const models = parseModelLines(result.stdout);
  if (models.length === 0) {
    return {
      source: "presets",
      models: FALLBACK_PRESETS,
      fetchedAt: now,
      hint: "`opencode models` returned no entries — using presets.",
    };
  }

  return {
    source: "live",
    models,
    fetchedAt: now,
    hint: `${models.length} models from \`${command} models\`.`,
  };
};
