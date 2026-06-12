import { spawnCapture, stripAnsi } from "@loom/adapter-utils";
import type { AdapterSelectOption, ListModelsFn } from "@loom/core";
import { ANTIGRAVITY_PRESET_MODELS } from "./preset-models.js";

// `agy models` prints one *display label* per line (e.g. "Claude Opus 4.6
// (Thinking)") — no machine ids. The model VALUE that antigravity actually
// consumes is an id (via `--model`), so we map each live label back to
// a preset id by normalised-label match. Recognised models keep their correct
// id; unrecognised lines are surfaced as-is so the user at least sees them.

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const PRESET_BY_LABEL: Map<string, AdapterSelectOption> = new Map(
  ANTIGRAVITY_PRESET_MODELS.map((m) => [norm(m.label), m] as const),
);

export function parseModelLines(stdout: string): AdapterSelectOption[] {
  const out: AdapterSelectOption[] = [];
  const seen = new Set<string>();
  for (const raw of stripAnsi(stdout).split("\n")) {
    const line = raw.trim();
    // Skip blanks and obvious non-model chrome (usage/flag headers, separators).
    if (!line || /^(usage|flags?|available|models?:)\b/i.test(line)) continue;
    if (!/[a-z0-9]/i.test(line)) continue;
    const preset = PRESET_BY_LABEL.get(norm(line));
    const opt: AdapterSelectOption = preset
      ? { ...preset }
      : { value: line, label: line, category: "Other" };
    if (seen.has(opt.value)) continue;
    seen.add(opt.value);
    out.push(opt);
  }
  return out;
}

export const antigravityListModels: ListModelsFn = async (input) => {
  const command = input.command ?? "agy";
  const now = new Date().toISOString();

  const result = await spawnCapture(command, ["models"], { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    return {
      source: "error",
      models: ANTIGRAVITY_PRESET_MODELS,
      fetchedAt: now,
      error: result.stderr.trim().slice(0, 200) || `exit ${result.exitCode}`,
      hint: "`agy models` failed — using presets. Make sure Antigravity CLI is installed and authenticated.",
    };
  }

  const models = parseModelLines(result.stdout);
  if (models.length === 0) {
    return {
      source: "presets",
      models: ANTIGRAVITY_PRESET_MODELS,
      fetchedAt: now,
      hint: "`agy models` returned no entries — using presets.",
    };
  }

  return {
    source: "live",
    models,
    fetchedAt: now,
    hint: `${models.length} models from \`${command} models\`.`,
  };
};
