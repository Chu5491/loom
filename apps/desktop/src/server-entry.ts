// 서버 부팅을 별도 CJS 번들(build/server.cjs)로 떼어내는 진입점. main 번들에
// 인라인되면 esbuild 가 config 를 부팅 시점보다 먼저 평가해 LOOM_HOME/WEB_DIR/PORT
// 환경변수가 안 먹는다 — 그래서 런타임 require 로 늦게 로드한다(main.startServer).
export { bootServer } from "@loom/server/boot";
