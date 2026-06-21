import { defineConfig } from "vitest/config";

// 순수 로직 단위 테스트(node 환경) — lib/derive·lib/report 등 프론트의 변환 로직.
// 컴포넌트 렌더 테스트가 필요해지면 environment 를 "jsdom" 으로 바꾸고 @testing-library 를
// 추가한다(현재는 JSX 없는 .test.ts 만 — 가장 가치 높고 flaky 하지 않은 로직부터).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
