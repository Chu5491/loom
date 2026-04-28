import {
  envIsSet,
  fileExists,
  homePath,
  probeBinary,
} from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

const ENV_VARS = ["OPENAI_API_KEY", "CODEX_API_KEY"];

const CRED_FILES = [
  homePath(".codex", "auth.json"),
  homePath(".codex", "config.toml"),
];

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) return { state: "authenticated", hint: `${v} is set` };
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `credential file: ${f}` };
  }
  return {
    state: "unauthenticated",
    hint: "Run `codex login` or set OPENAI_API_KEY.",
  };
}

export const codexProbe: ProbeFn = async (input) => {
  const command = input.command ?? "codex";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
