// 디스크 여유 가드 — 새 run 시작 전 data/ 볼륨에 충분한 공간이 있는지 확인.
// 꽉 찬 채 돌면 raw 로그 쓰기 실패로 run 이 죽고(engine writeRaw) 이벤트를 잃는다.

import fs from "node:fs/promises";
import { config } from "../config.js";
import { logger } from "../logger.js";

/** 순수 — 여유 바이트가 요구치(MB) 미만인가. minFreeMb<=0 이면 항상 false(비활성). */
export function isBelowFree(freeBytes: number, minFreeMb: number): boolean {
  return minFreeMb > 0 && freeBytes < minFreeMb * 1024 * 1024;
}

/** data/ 볼륨 여유 확인. 측정 실패는 통과로 친다 — 가드의 목적은 꽉 찼을 때 막는
 *  것이지, 측정 불가로 정상 run 을 막는 게 아니다. */
export async function ensureDiskSpace(): Promise<{ ok: true } | { ok: false; freeMb: number }> {
  if (config.minFreeMb <= 0) return { ok: true };
  try {
    const st = await fs.statfs(config.home); // data/ 와 같은 볼륨, 항상 존재
    const freeBytes = st.bavail * st.bsize;
    if (isBelowFree(freeBytes, config.minFreeMb)) {
      return { ok: false, freeMb: Math.floor(freeBytes / (1024 * 1024)) };
    }
  } catch (err) {
    logger.warn({ err }, "disk space check failed — allowing run");
  }
  return { ok: true };
}
