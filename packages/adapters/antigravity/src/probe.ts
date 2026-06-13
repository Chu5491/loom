import {
  dirExistsAndNotEmpty,
  envIsSet,
  fileExists,
  homePath,
  probeBinary,
} from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

const ENV_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

const CRED_FILES = [
  homePath(".gemini", "credentials.json"),
  homePath(".gemini", "settings.json"),
  homePath(".config", "gcloud", "application_default_credentials.json"),
];

// antigravity stores the OAuth token in the OS keychain ("Antigravity Safe
// Storage"), so there is no credentials file. Newer CLI versions also migrated
// config out of ~/.gemini into ~/.gemini/antigravity-cli (a config/.migrated
// marker is left behind). The best filesystem signal is "an initialized config
// dir exists" — same approach as claude-code's keychain fallback.
const CONFIG_FILES = [
  homePath(".gemini", "antigravity-cli", "settings.json"),
];
const CONFIG_DIRS = [
  homePath(".gemini", "antigravity-cli"),
  homePath(".gemini", "antigravity"),
];

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) return { state: "authenticated", hint: `${v} is set` };
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `credential file: ${f}` };
  }
  for (const f of CONFIG_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `config: ${f} (token may be in OS keychain)` };
  }
  for (const d of CONFIG_DIRS) {
    if (dirExistsAndNotEmpty(d)) {
      return { state: "authenticated", hint: `config dir: ${d} (token may be in OS keychain)` };
    }
  }
  return {
    state: "unauthenticated",
    hint: "Run `agy` to log in, or set GEMINI_API_KEY / GOOGLE_API_KEY.",
  };
}

export const antigravityProbe: ProbeFn = async (input) => {
  const command = input.command ?? "agy";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
