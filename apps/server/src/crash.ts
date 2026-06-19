// 프로세스 레벨 크래시 가드 — fire-and-forget(void run 등) 비동기 누락이나 동기 예외가
// 서버 전체(+진행 중 run)를 조용히 죽이지 않도록. 두 종류를 분리:
//   - unhandledRejection: 격리된 비동기 버그 → 로그만, 서버는 계속(dev·desktop 안전).
//   - uncaughtException : 동기 예외 → 상태 불확실하니 graceful 종료 후 exit(재시작 위임).
//     종료 동작이라 dev/CLI 진입점에서만 무장(Electron 자체 처리와 충돌 회피).

import { logger } from "./logger.js";

/** 누락된 .catch 로 인한 unhandledRejection 을 잡아 로그만 남기고 서버를 계속 서빙한다.
 *  Node 기본값(unhandledRejection 시 프로세스 종료)을 덮어, 한 run 의 비동기 누락이
 *  전체(+다른 진행 중 run)를 내리지 않게 한다. 종료하지 않으므로 desktop 에서도 안전. */
export function installAsyncGuard(): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection — logged, server continues");
  });
}

/** uncaughtException(동기 예외)은 상태가 불확실 — 로그 후 graceful shutdown 하고 비-0 으로
 *  종료(프로세스 매니저/사용자가 재시작). shutdown 이 늦어져도 종료를 보장. */
export function installCrashShutdown(shutdown: () => Promise<void>): void {
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException — graceful shutdown then exit(1)");
    void shutdown().finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 2500).unref();
  });
}
