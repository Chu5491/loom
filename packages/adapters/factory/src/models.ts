import type { ListModelsFn } from "@loom/core";
import { DROID_PRESET_MODELS } from "./preset-models.js";

// Factory droid 는 공개 모델-목록 명령(API)이 없다 — 구독 관리형 풀이라 계정·플랜에
// 따라 제공 모델이 정해진다. 그래서 라이브 fetch 없이 preset 을 돌려준다.
// (인증 후 실제 id 가 다르면 preset-models.ts 를 갱신.)
export const factoryListModels: ListModelsFn = async () => ({
  source: "presets",
  models: DROID_PRESET_MODELS,
  fetchedAt: new Date().toISOString(),
  hint: "Factory droid has no public model-list command; showing presets. Verify exact model ids after sign-in.",
});
