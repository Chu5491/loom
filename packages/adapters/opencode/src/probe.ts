import {
  envIsSet,
  homePath,
  jsonObjectHasKeys,
  probeBinary,
} from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

// OpenCode supports many providers — any of these env vars confirms at least
// one is wired up.
const ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
];

// opencode keeps credentials ONLY in this plaintext provider-keyed map (no
// keychain). A logged-out install still has the file as `{}`, so existence is
// not enough — it must hold ≥1 provider. The config dir is no signal at all
// (logs/cache exist regardless of login).
const CRED_FILES = [
  homePath(".local", "share", "opencode", "auth.json"),
  homePath(".config", "opencode", "auth.json"),
];

function checkAuth(): AuthStatus {
  const setVars = ENV_VARS.filter(envIsSet);
  if (setVars.length > 0) {
    return {
      state: "authenticated",
      hint: `env: ${setVars.join(", ")}`,
    };
  }
  for (const f of CRED_FILES) {
    if (jsonObjectHasKeys(f)) return { state: "authenticated", hint: `auth file: ${f}` };
  }
  return {
    state: "unauthenticated",
    hint: "Run `opencode auth login <provider>` or set a provider API key.",
  };
}

export const opencodeProbe: ProbeFn = async (input) => {
  const command = input.command ?? "opencode";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
