import { probeBinary } from "@loom/adapter-utils";
import type { ProbeFn } from "@loom/core";

// opencode is open-source and bring-your-own-provider — it has NO vendor login.
// Providers (env keys, `opencode auth login`, or local models) are the user's
// choice and may live in places we can't reliably read. So for loom's purposes
// "installed" == ready: if the binary is present, report authenticated.
export const opencodeProbe: ProbeFn = async (input) => {
  const command = input.command ?? "opencode";
  const binary = await probeBinary(command);
  const auth = binary.available
    ? { state: "authenticated" as const, hint: "installed — opencode needs no login (bring your own provider)" }
    : { state: "unknown" as const };
  return { binary, auth, checkedAt: new Date().toISOString() };
};
