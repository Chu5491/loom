import {
  envIsSet,
  fileExists,
  homePath,
  probeBinary,
} from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

// Devin authenticates via `devin auth` / `devin setup`; the config lives at
// ~/.config/devin/config.json. DEVIN_API_KEY is checked as an env fallback.
const ENV_VARS = ["DEVIN_API_KEY"];

const CRED_FILES = [
  homePath(".config", "devin", "config.json"),
  homePath(".devin", "config.json"),
];

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) return { state: "authenticated", hint: `${v} is set` };
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `config file: ${f}` };
  }
  return {
    state: "unauthenticated",
    hint: "Run `devin auth` (or `devin setup`) to sign in.",
  };
}

export const devinProbe: ProbeFn = async (input) => {
  const command = input.command ?? "devin";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
