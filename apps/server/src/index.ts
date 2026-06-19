// loom v2-core — CLI 통합 허브. 부팅 본체는 boot.ts(데스크톱 main 과 공유).
// 이 진입점은 dev/CLI 용: bootServer 후 프로세스 시그널에 종료를 묶는다.

import { bootServer } from "./boot.js";
import { installCrashShutdown } from "./crash.js";

const { shutdown } = await bootServer();

const onSignal = () => {
  void shutdown().then(() => process.exit(0));
  // shutdown 이 늦어져도 종료는 보장.
  setTimeout(() => process.exit(0), 2500).unref();
};

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
// 동기 예외(uncaughtException)는 상태가 불확실 — 로그 후 graceful 종료(재시작 위임).
// 비동기 unhandledRejection 은 boot.ts 에서 로그만(서버 유지). desktop 은 Electron 처리.
installCrashShutdown(shutdown);
