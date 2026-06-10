// 서버 설정. v2-core: CLI 연결 허브만 — DB/로그/워크트리 디렉토리 없음.
// 잘못된 값은 import 시점에 즉시 throw.

const rawPort = process.env.LOOM_PORT ?? "3200";
const port = Number(rawPort);
if (!Number.isFinite(port) || port < 0 || port > 65535) {
  throw new Error(`LOOM_PORT 값이 잘못됨: "${rawPort}" — 0~65535 사이 정수 필요`);
}

const host = process.env.LOOM_HOST ?? "127.0.0.1";

export const config = { port, host } as const;
