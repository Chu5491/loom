// 토큰 → USD 비용 추정. CLI 가 cost 를 직접 안 주는 경우(codex)만 쓰인다.
// 단가는 모델마다 바뀌므로 근사 — 정확한 청구는 각 제공자 콘솔이 진실.
// 키는 모델 id 의 접두 매칭(부분 문자열). 못 맞히면 보수적 기본값.
//
// 단위: USD per 1M tokens [input, output]. 2026 초 기준 공개가 근사치.

interface Rate {
  input: number;
  output: number;
}

// 접두/부분 문자열 → 단가. 위에서부터 첫 매칭 사용(구체적인 걸 먼저).
const RATES: Array<[string, Rate]> = [
  ["gpt-5.4-mini", { input: 0.25, output: 2 }],
  ["gpt-5.4", { input: 1.25, output: 10 }],
  ["gpt-5", { input: 1.25, output: 10 }],
  ["o4-mini", { input: 1.1, output: 4.4 }],
  ["o4", { input: 15, output: 60 }],
  ["o3", { input: 2, output: 8 }],
  ["gpt-4.1-mini", { input: 0.4, output: 1.6 }],
  ["gpt-4.1", { input: 2, output: 8 }],
  ["gpt-4o-mini", { input: 0.15, output: 0.6 }],
  ["gpt-4o", { input: 2.5, output: 10 }],
  // 비-OpenAI 모델을 codex/opencode 가 돌릴 수도 — opencode 는 자체 cost 를 주니
  // 추정이 필요한 건 주로 codex(OpenAI) 다. 모르는 모델은 기본값.
];

// 모르는 모델의 보수적 기본 — 과소평가보다 약간 과대평가가 예산 가드에 안전.
const DEFAULT: Rate = { input: 1, output: 5 };

function rateFor(model: string | undefined): Rate {
  if (!model) return DEFAULT;
  const m = model.toLowerCase();
  for (const [prefix, rate] of RATES) {
    if (m.includes(prefix)) return rate;
  }
  return DEFAULT;
}

// 캐시 적중 input 의 단가 배수 — 캐시 읽기는 재처리가 아니라 ~10%(OpenAI·Anthropic 공통
// 근사). loom 의 안정 시스템프롬프트 설계는 캐시 적중률을 높여, 캐시분을 풀가격으로 치면
// 비용이 과대평가된다. 정확한 청구는 제공자 콘솔이 진실 — 여기선 근사 보정.
const CACHE_RATE = 0.1;

/** 입력/출력 토큰 → 추정 USD. 토큰이 둘 다 없으면 null(추정 불가).
 *  cachedInputTokens(inputTokens 의 부분집합)는 캐시 단가로 할인한다. */
export function estimateCost(
  model: string | undefined,
  inputTokens?: number,
  outputTokens?: number,
  cachedInputTokens?: number,
): number | null {
  if (!inputTokens && !outputTokens) return null;
  const r = rateFor(model);
  const input = inputTokens ?? 0;
  const cached = Math.min(cachedInputTokens ?? 0, input); // 부분집합 보장
  const fresh = input - cached;
  const cost = (fresh * r.input + cached * r.input * CACHE_RATE + (outputTokens ?? 0) * r.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6자리 반올림
}
