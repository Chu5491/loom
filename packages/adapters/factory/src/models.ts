import type { AdapterSelectOption, ListModelsFn } from "@loom/core";
import { spawnCapture, stripAnsi } from "@loom/adapter-utils";
import { DROID_PRESET_MODELS } from "./preset-models.js";

/** droid 모델 목록 추출 — droid 는 목록 API 가 없지만, *잘못된* 모델로 `exec` 하면 인증
 *  *전에* "Available built-in models" + "Available custom models" 를 출력한다(실측,
 *  droid 0.150.1). built-in = 콤마구분 id 줄, custom = `custom:<id> (<displayName>)` 줄.
 *  exported for tests. */
export function parseDroidModels(out: string): { builtins: string[]; customs: { id: string; label: string }[] } {
  const builtins: string[] = [];
  const customs: { id: string; label: string }[] = [];
  let section: "builtin" | "custom" | null = null;
  for (const raw of stripAnsi(out).split("\n")) {
    const line = raw.trim();
    if (/^Available built-in models/i.test(line)) { section = "builtin"; continue; }
    if (/^Available custom models/i.test(line)) { section = "custom"; continue; }
    if (/^Note:/i.test(line)) { section = null; continue; }
    if (!line || /^Invalid model/i.test(line)) continue;
    if (section === "builtin") {
      for (const id of line.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!builtins.includes(id)) builtins.push(id);
      }
    } else if (section === "custom") {
      const m = /^(custom:[^\s()]+)(?:\s*\(([^)]*)\))?/.exec(line);
      if (m) {
        const id = m[1];
        if (id && !customs.some((c) => c.id === id)) customs.push({ id, label: m[2] || id });
      }
    }
  }
  return { builtins, customs };
}

// 동적 목록: 잘못된 모델로 exec 해 인증 전에 뱉는 목록을 파싱한다(custom 모델까지 노출 —
// ollama 등 BYO 는 Factory 로그인 없이 쓸 수 있어 select 에 꼭 보여야 한다). 모델 검증이
// 먼저라 실제 실행·과금은 없다. 실패 시 preset 폴백.
export const factoryListModels: ListModelsFn = async (input) => {
  const command = input.command ?? "droid";
  const now = new Date().toISOString();
  let out = "";
  try {
    const r = await spawnCapture(command, ["exec", "--model", "__loom_list__", "probe"], { timeoutMs: 15_000 });
    out = `${r.stdout}\n${r.stderr}`;
  } catch {
    // droid 미설치/실행 실패 — preset 폴백.
  }
  const { builtins, customs } = parseDroidModels(out);
  if (builtins.length === 0 && customs.length === 0) {
    return {
      source: "presets",
      models: DROID_PRESET_MODELS,
      fetchedAt: now,
      hint: "droid 모델 목록을 못 읽음 — preset 표시(`droid` 설치/PATH 확인).",
    };
  }
  // custom(사용자 BYO/로컬)을 먼저 — 가장 관련 높음. built-in 은 preset 의 라벨/카테고리 재사용,
  // preset 에 없는 신규 id(예: glm-5.2)는 기본 라벨로.
  const presetById = new Map(DROID_PRESET_MODELS.map((m) => [m.value, m]));
  const customOpts: AdapterSelectOption[] = customs.map((c) => ({
    value: c.id,
    label: `${c.label} — custom`,
    description: "BYO/로컬 (~/.factory/settings.json) · Factory 로그인 불요",
    category: "Custom",
  }));
  const builtinOpts: AdapterSelectOption[] = builtins.map(
    (id) => presetById.get(id) ?? { value: id, label: id, category: "Droid" },
  );
  return {
    source: "live",
    models: [...customOpts, ...builtinOpts],
    fetchedAt: now,
    hint: `${customOpts.length} custom + ${builtinOpts.length} built-in (droid 실측). custom 은 Factory 로그인 없이 사용 가능.`,
  };
};
