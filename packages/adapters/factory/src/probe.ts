import fs from "node:fs";
import { envIsSet, fileExists, homePath, probeBinary } from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

// Factory 클라우드 인증 흔적: FACTORY_API_KEY(헤드리스/CI) 또는 `droid` /login 토큰(auth.json).
// 단, settings.json 의 customModels(BYO/로컬, 예: ollama)가 있으면 Factory 로그인 *없이도*
// droid exec 가 돈다(402 우회 실측) — 그 경우도 "사용 가능" 으로 본다(클라우드 관리형
// 모델만 로그인 필요). settings.json 자체는 인증 증거가 아니지만 customModels 는 사용성 신호다.
const ENV_VARS = ["FACTORY_API_KEY"];
const CRED_FILES = [homePath(".factory", "auth.json")];

/** ~/.factory/settings.json 의 customModels 개수(BYO/로컬). */
function customModelCount(): number {
  try {
    const j = JSON.parse(fs.readFileSync(homePath(".factory", "settings.json"), "utf8")) as { customModels?: unknown };
    return Array.isArray(j.customModels) ? j.customModels.length : 0;
  } catch {
    return 0; // 없거나 깨짐
  }
}

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) return { state: "authenticated", hint: `${v} is set` };
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `credential file: ${f}` };
  }
  const customs = customModelCount();
  if (customs > 0) {
    return {
      state: "authenticated",
      hint: `${customs} custom model(s) — Factory 로그인 없이 사용 가능(클라우드 관리형 모델은 로그인 필요)`,
    };
  }
  return {
    state: "unauthenticated",
    hint: "`droid` 로그인하거나 FACTORY_API_KEY 설정, 또는 ~/.factory/settings.json 에 custom 모델 추가.",
  };
}

export const factoryProbe: ProbeFn = async (input) => {
  const command = input.command ?? "droid";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
