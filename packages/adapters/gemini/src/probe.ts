import {
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

function checkAuth(): AuthStatus {
  for (const v of ENV_VARS) {
    if (envIsSet(v)) return { state: "authenticated", hint: `${v} is set` };
  }
  for (const f of CRED_FILES) {
    if (fileExists(f)) return { state: "authenticated", hint: `credential file: ${f}` };
  }
  return {
    state: "unauthenticated",
    hint: "Run `gemini auth login` or set GEMINI_API_KEY / GOOGLE_API_KEY.",
  };
}

export const geminiProbe: ProbeFn = async (input) => {
  const command = input.command ?? "gemini";
  const binary = await probeBinary(command);
  const auth = binary.available ? checkAuth() : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
