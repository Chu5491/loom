import type { AdapterSelectOption } from "@loom/core";

/**
 * Factory droid `-m/--model` 모델 카탈로그. droid 는 구독에 **관리형(managed) 모델**을
 * 포함한다 — Anthropic·OpenAI·Google 프런티어 + Droid Core(오픈웨이트). 전 티어가 같은
 * 모델 풀을 공유하고 차이는 사용량 한도(5x/10x)뿐.
 *
 * id 는 추정이 아니라 **실측**이다: droid 0.150.1 `droid exec --help` 의 "Available Models"
 * 전수(비-deprecated 32종)를 그대로 옮겼다(잘못된 id 는 exit 1 → 사용자 혼란의 원인이었음).
 * `*-fast`(빠른 변형)·`*-pro`(고추론)도 별개 id 다. deprecated(gpt-5.2-codex,
 * gpt-5.1-codex-max)는 제외. 임의/자체호스팅 모델은 **`--model custom:<id>`** 또는 Custom…
 * 입력(manifest allowCustom)으로 — preset 에 없어도 쓸 수 있다.
 */
export const DROID_PRESET_MODELS: AdapterSelectOption[] = [
  // ── Anthropic (managed) ──────────────────────────────────────────────
  { value: "claude-opus-4-8", label: "Claude Opus 4.8", description: "최상위 추론(droid 기본 모델).", category: "Anthropic" },
  { value: "claude-opus-4-8-fast", label: "Claude Opus 4.8 Fast", description: "Opus 4.8 빠른 변형.", category: "Anthropic" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", category: "Anthropic" },
  { value: "claude-opus-4-7-fast", label: "Claude Opus 4.7 Fast", category: "Anthropic" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6", category: "Anthropic" },
  { value: "claude-opus-4-6-fast", label: "Claude Opus 4.6 Fast", category: "Anthropic" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", category: "Anthropic" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "균형형.", category: "Anthropic" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", category: "Anthropic" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "빠르고 저렴.", category: "Anthropic" },
  // ── OpenAI (managed) ─────────────────────────────────────────────────
  { value: "gpt-5.5", label: "GPT-5.5", category: "OpenAI" },
  { value: "gpt-5.5-fast", label: "GPT-5.5 Fast", category: "OpenAI" },
  { value: "gpt-5.5-pro", label: "GPT-5.5 Pro", description: "고추론 변형.", category: "OpenAI" },
  { value: "gpt-5.4", label: "GPT-5.4", category: "OpenAI" },
  { value: "gpt-5.4-fast", label: "GPT-5.4 Fast", category: "OpenAI" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "경량.", category: "OpenAI" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "코딩 특화.", category: "OpenAI" },
  { value: "gpt-5.3-codex-fast", label: "GPT-5.3 Codex Fast", category: "OpenAI" },
  { value: "gpt-5.2", label: "GPT-5.2", category: "OpenAI" },
  // ── Google (managed) ─────────────────────────────────────────────────
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", category: "Google" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "저비용 빠른 모델.", category: "Google" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", category: "Google" },
  // ── Droid Core (오픈웨이트, 한도 소진 후에도 추가비용 0) ───────────────
  { value: "glm-5.1", label: "GLM-5.1", category: "Droid Core" },
  { value: "kimi-k2.7-code", label: "Kimi K2.7 Code", description: "코딩 특화.", category: "Droid Core" },
  { value: "kimi-k2.6", label: "Kimi K2.6", category: "Droid Core" },
  { value: "kimi-k2.5", label: "Kimi K2.5", category: "Droid Core" },
  { value: "nemotron-3-ultra", label: "Nemotron 3 Ultra", category: "Droid Core" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", category: "Droid Core" },
  { value: "minimax-m3", label: "MiniMax M3", category: "Droid Core" },
  { value: "minimax-m2.7", label: "MiniMax M2.7", description: "최저가 폴백.", category: "Droid Core" },
  { value: "minimax-m2.5", label: "MiniMax M2.5", category: "Droid Core" },
];
