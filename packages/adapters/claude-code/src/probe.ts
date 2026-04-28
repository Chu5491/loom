import {
  dirExistsAndNotEmpty,
  envIsSet,
  fileExists,
  homePath,
  probeBinary,
} from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

const ENV_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

const CRED_FILES = [
  homePath(".claude", ".credentials.json"),
  homePath(".config", "claude", "credentials.json"),
];

// claude-code stores subscription tokens in the OS keychain on macOS, so the
// best filesystem signal is "the config dir exists and looks initialized".
const CONFIG_DIRS = [homePath(".claude"), homePath(".config", "claude")];
const CONFIG_FILES = [
  homePath(".claude", "settings.json"),
  homePath(".config", "claude", "settings.json"),
];

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) {
      return { state: "authenticated", hint: `${v} is set` };
    }
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) {
      return { state: "authenticated", hint: `credential file: ${f}` };
    }
  }
  // Subscription users authenticate via keychain — no credentials file. The
  // existence of an initialized config dir is the strongest filesystem signal.
  for (const f of CONFIG_FILES) {
    if (fileExists(f)) {
      return {
        state: "authenticated",
        hint: `config: ${f} (token may be in OS keychain)`,
      };
    }
  }
  for (const d of CONFIG_DIRS) {
    if (dirExistsAndNotEmpty(d)) {
      return {
        state: "authenticated",
        hint: `config dir: ${d} (token may be in OS keychain)`,
      };
    }
  }
  return {
    state: "unauthenticated",
    hint: "Run `claude login` or set ANTHROPIC_API_KEY.",
  };
}

export const claudeCodeProbe: ProbeFn = async (input) => {
  const command = input.command ?? "claude";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
