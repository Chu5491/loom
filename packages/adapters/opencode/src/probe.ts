import {
  envIsSet,
  homePath,
  jsonObjectHasKeys,
  probeBinary,
} from "@loom/adapter-utils";
import type { AuthStatus, ProbeFn } from "@loom/core";

// opencode itself has NO vendor login (open-source, bring-your-own-provider).
// "authenticated" here means "≥1 provider is attached" — via an env key or the
// auth.json map. Any of these provider keys confirms one is wired up.
const ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
];

// `opencode auth login <provider>` writes keys ONLY into this plaintext
// provider-keyed map (no keychain). A fresh install with no provider is `{}`,
// so existence is not enough — it must hold ≥1 provider. The config dir is no
// signal (logs/cache exist regardless).
const CRED_FILES = [
  homePath(".local", "share", "opencode", "auth.json"),
  homePath(".config", "opencode", "auth.json"),
];

function checkAuth(): AuthStatus {
  const setVars = ENV_VARS.filter(envIsSet);
  if (setVars.length > 0) {
    return {
      state: "authenticated",
      hint: `provider via env: ${setVars.join(", ")}`,
    };
  }
  for (const f of CRED_FILES) {
    if (jsonObjectHasKeys(f)) return { state: "authenticated", hint: `provider attached: ${f}` };
  }
  // Not a failed login — opencode needs no vendor login, just a provider.
  return {
    state: "unauthenticated",
    hint: "No provider attached yet — opencode needs no login. Run `opencode auth login <provider>` or set a provider API key.",
  };
}

export const opencodeProbe: ProbeFn = async (input) => {
  const command = input.command ?? "opencode";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
