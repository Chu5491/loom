// 외부 IDE를 spawn해서 사용자의 데스크톱에서 파일/디렉터리를 열어주는 helper.
//
// IDE 해석은 다음 우선순위:
//   1. PATH의 CLI (`code`, `cursor`, `zed`, `idea`, ...) → 라인 점프 지원
//   2. macOS 앱 번들 안의 CLI 절대경로 (Cmd+Shift+P "Install code" 안 한 사용자용)
//   3. macOS `open -a "<App Name>"` (라인 점프 X, 그래도 IDE는 열림)
//
// VS Code 사용자 대부분은 shell command를 PATH에 안 넣으므로 (1)이 실패함 —
// (2)/(3)이 실제 거의 모든 macOS 케이스를 커버.

import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PreferredEditor } from "@loom/core";

export interface OpenRequest {
  /** 절대 경로. 디렉터리든 파일이든 OK. */
  target: string;
  /** 1-based. 파일이고 IDE가 지원하면 해당 라인으로 이동. */
  line?: number;
  /** 사용자가 선택한 IDE. */
  editor: PreferredEditor;
}

export type OpenResult =
  | { ok: true; command: string; args: string[] }
  | {
      ok: false;
      reason: "spawn_failed" | "no_cli_found" | "invalid_target";
      detail?: string;
    };

interface EditorSpec {
  /** PATH에서 찾을 CLI 후보들. */
  pathCandidates: ReadonlyArray<string>;
  /** 절대 경로로 시도할 CLI 후보들 — 보통 macOS 앱 번들 내부.
   *  `~`은 자동 expand. 사용자 환경에서 첫 번째 존재하는 게 채택됨. */
  absoluteCandidates?: ReadonlyArray<string>;
  /** macOS `open -a "<name>"` 폴백용 앱 이름. line 점프 X. */
  macAppName?: string;
  /** 발견된 CLI에 대해 인자 배열 빌드. line이 있고 IDE가 지원하면 점프. */
  buildArgs: (target: string, line?: number) => string[];
}

const HOME = os.homedir();
const expand = (p: string): string =>
  p.startsWith("~/") ? path.join(HOME, p.slice(2)) : p;

// 각 IDE의 호출 규약은 공식 docs 또는 `<cmd> --help` 기준.
// macOS 절대경로는 표준 설치 위치 기준(사용자가 다른 곳에 설치하면 PATH에서 잡혀야 함).
const SPECS: Record<PreferredEditor, EditorSpec> = {
  vscode: {
    pathCandidates: ["code"],
    absoluteCandidates: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "~/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      // VS Code Insiders도 같은 enum으로 묶어 처리 — 사용자가 stable과
      // insiders를 동시 운영해도 stable이 없으면 insiders 사용.
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
    ],
    macAppName: "Visual Studio Code",
    buildArgs: (target, line) =>
      line ? ["-g", `${target}:${line}`] : [target],
  },
  cursor: {
    pathCandidates: ["cursor"],
    absoluteCandidates: [
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "~/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    ],
    macAppName: "Cursor",
    buildArgs: (target, line) =>
      line ? ["-g", `${target}:${line}`] : [target],
  },
  antigravity: {
    pathCandidates: ["antigravity"],
    absoluteCandidates: [
      "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity",
      "~/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity",
    ],
    macAppName: "Antigravity",
    buildArgs: (target, line) =>
      line ? ["-g", `${target}:${line}`] : [target],
  },
  zed: {
    pathCandidates: ["zed"],
    absoluteCandidates: [
      "/Applications/Zed.app/Contents/MacOS/cli",
      "~/Applications/Zed.app/Contents/MacOS/cli",
    ],
    macAppName: "Zed",
    buildArgs: (target, line) => [line ? `${target}:${line}:1` : target],
  },
  intellij: {
    pathCandidates: ["idea", "intellij-idea-ultimate", "intellij-idea-community"],
    absoluteCandidates: [
      "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
      "/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea",
      "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
      "~/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
      "~/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea",
      "~/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
    ],
    macAppName: "IntelliJ IDEA",
    buildArgs: (target, line) =>
      line ? ["--line", String(line), target] : [target],
  },
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isOnPath(cmd: string): Promise<string | null> {
  const PATH = process.env.PATH ?? "";
  const dirs = PATH.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, cmd);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

interface ResolvedExec {
  command: string;
  args: string[];
  via: "path" | "absolute" | "open-a";
}

async function resolveExec(
  spec: EditorSpec,
  target: string,
  line: number | undefined,
): Promise<ResolvedExec | null> {
  // 1) PATH에서 CLI 찾기
  for (const cmd of spec.pathCandidates) {
    const found = await isOnPath(cmd);
    if (found) {
      return { command: cmd, args: spec.buildArgs(target, line), via: "path" };
    }
  }
  // 2) 알려진 절대 경로(앱 번들 내부 CLI)
  if (spec.absoluteCandidates) {
    for (const raw of spec.absoluteCandidates) {
      const abs = expand(raw);
      if (await exists(abs)) {
        return {
          command: abs,
          args: spec.buildArgs(target, line),
          via: "absolute",
        };
      }
    }
  }
  // 3) macOS `open -a "<name>"` 폴백 — 라인 점프 못하지만 IDE는 열림.
  //    `open`은 항상 macOS PATH에 있어 별도 체크 불필요.
  if (process.platform === "darwin" && spec.macAppName) {
    return {
      command: "open",
      args: ["-a", spec.macAppName, target],
      via: "open-a",
    };
  }
  return null;
}

export async function openInEditor(req: OpenRequest): Promise<OpenResult> {
  if (!req.target || !path.isAbsolute(req.target)) {
    return { ok: false, reason: "invalid_target" };
  }
  const spec = SPECS[req.editor];
  const exec = await resolveExec(spec, req.target, req.line);
  if (!exec) {
    return {
      ok: false,
      reason: "no_cli_found",
      detail: `Tried PATH (${spec.pathCandidates.join(", ")})${
        spec.absoluteCandidates
          ? `, app bundles (${spec.absoluteCandidates.length} paths)`
          : ""
      }${process.platform === "darwin" && spec.macAppName ? `, open -a "${spec.macAppName}"` : ""}`,
    };
  }

  // detached + unref — 사용자가 IDE를 종료해도 서버 프로세스가 같이 죽지 않게.
  try {
    const child = spawn(exec.command, exec.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { ok: true, command: exec.command, args: exec.args };
  } catch (err) {
    return {
      ok: false,
      reason: "spawn_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
