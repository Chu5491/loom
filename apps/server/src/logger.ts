// 구조화 로거. 개발에서는 pino-pretty로 컬러 출력, 프로덕션은 raw JSON.
// 자식 logger에 runId/agentId/threadId를 매번 묶어 추적 가능.

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),
});

export type Logger = typeof logger;

export function runLogger(runId: string, ctx: Record<string, unknown> = {}): Logger {
  return logger.child({ runId, ...ctx });
}
