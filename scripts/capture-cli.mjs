#!/usr/bin/env node
// 검증용 가짜 CLI — 실제 CLI 대신 spawn되어, 자기가 받은 argv/stdin/관련 env를
// JSON 한 줄로 덤프하고 exit 0. 어댑터의 실제 주입 경로(buildCommand +
// applyMcpServers + applyPrompt + resolveEnv)를 그대로 통과한 결과가 찍힌다.
// → "각 CLI에 정확히 무엇이 날아가는가" + "CLI root를 무시하는가" 를 증명.

let stdin = "";
let done = false;

function dump() {
  if (done) return;
  done = true;
  // secret 값은 흘리지 않음 — 격리/주입 판단에 필요한 키만 값 노출.
  const peek = [
    "XDG_CONFIG_HOME",
    "OPENCODE_DISABLE_PROJECT_CONFIG",
    "CODEX_HOME",
    "ANTHROPIC_MCP_CONFIG",
  ];
  const env = {};
  for (const k of peek) if (process.env[k] !== undefined) env[k] = process.env[k];
  process.stdout.write(
    JSON.stringify({
      __capture: true,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      stdin,
      env,
      envInjectedKeys: Object.keys(process.env).filter((k) =>
        /^(LOOM_|OPENCODE_|XDG_|CODEX_|ANTHROPIC_|GEMINI_|GOOGLE_|OPENAI_|DEVIN_)/.test(k),
      ),
    }) + "\n",
  );
  process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", dump);
// arg-기반 어댑터(stdin 안 씀)는 end가 즉시/안 올 수 있어 짧은 타임아웃으로도 덤프.
setTimeout(dump, 400);
