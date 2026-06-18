import { envIsSet, fileExists, homePath, probeBinary } from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

// Factory 인증 흔적. FACTORY_API_KEY(헤드리스/CI) 또는 `droid` /login 으로 생기는
// 토큰 파일(auth.json) 만 본다.
// 주의: settings.json 은 droid 를 한 번 실행하기만 해도 생기는 설정 파일이라 인증
//   증거가 아니다. 그것까지 인증으로 치면 미로그인 상태인데 '인증됨' 으로 오판해,
//   실제 `droid exec` 는 "Authentication failed" 로 exit 1 한다(실측). 토큰만 본다.
const ENV_VARS = ["FACTORY_API_KEY"];
const CRED_FILES = [homePath(".factory", "auth.json")];

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) return { state: "authenticated", hint: `${v} is set` };
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `credential file: ${f}` };
  }
  return {
    state: "unauthenticated",
    hint: "Run `droid` and sign in (or set FACTORY_API_KEY).",
  };
}

export const factoryProbe: ProbeFn = async (input) => {
  const command = input.command ?? "droid";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
