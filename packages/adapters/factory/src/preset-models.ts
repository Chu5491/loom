import type { AdapterSelectOption } from "@loom/core";

/**
 * Factory droid `-m/--model` 모델 카탈로그. droid 는 구독에 **관리형(managed) 모델**을
 * 포함한다 — Anthropic·OpenAI·Google 프런티어 + Droid Core(오픈웨이트). 전 티어가 같은
 * 모델 풀을 공유하고 차이는 사용량 한도(5x/10x)뿐.
 *
 * id 는 추정이 아니라 **실측**이다: droid 0.150.1 에서 `droid exec --model __invalid__`
 * 가 토해낸 "Available built-in models" 목록을 그대로 옮겼다(잘못된 id 는 exit 1 →
 * 사용자 혼란의 원인이었음). 임의 id·custom 모델은 Custom… 으로 입력하거나
 * ~/.factory/settings.json 에 등록한다.
 */
export const DROID_PRESET_MODELS: AdapterSelectOption[] = [
  // ── Anthropic (managed) ──────────────────────────────────────────────
  { value: "claude-opus-4-8", label: "Claude Opus 4.8", description: "최상위 추론(droid 기본 모델).", category: "Anthropic" },
  { value: "claude-opus-4-8-fast", label: "Claude Opus 4.8 Fast", description: "Opus 4.8 빠른 변형.", category: "Anthropic" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", category: "Anthropic" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "균형형.", category: "Anthropic" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "빠르고 저렴.", category: "Anthropic" },
  // ── OpenAI (managed) ─────────────────────────────────────────────────
  { value: "gpt-5.5", label: "GPT-5.5", category: "OpenAI" },
  { value: "gpt-5.4", label: "GPT-5.4", category: "OpenAI" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "코딩 특화.", category: "OpenAI" },
  { value: "gpt-5.2", label: "GPT-5.2", category: "OpenAI" },
  // ── Google (managed) ─────────────────────────────────────────────────
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", category: "Google" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "저비용 빠른 모델.", category: "Google" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", category: "Google" },
  // ── Droid Core (오픈웨이트, 한도 소진 후에도 추가비용 0) ───────────────
  { value: "glm-5.1", label: "GLM-5.1", category: "Droid Core" },
  { value: "kimi-k2.7-code", label: "Kimi K2.7 Code", category: "Droid Core" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", category: "Droid Core" },
  { value: "minimax-m3", label: "MiniMax M3", category: "Droid Core" },
  { value: "minimax-m2.7", label: "MiniMax M2.7", description: "최저가 폴백.", category: "Droid Core" },
  { value: "nemotron-3-ultra", label: "Nemotron 3 Ultra", category: "Droid Core" },
];
