// `git clone` 래퍼 — 새 프로젝트를 git URL 에서 만들 때 사용.
//
// 인증은 사용자의 git credential helper / ssh-agent 에 위임. loom 은 자격증명을
// 저장하지 않음 (git push 와 같은 패턴). 인증 실패면 git 의 stderr 가 그대로
// 라우트의 에러 메시지로 → 토스트.
//
// clone 위치: `<paths.repos>/<projectId>/`. 프로젝트 id 가 곧 폴더명이라 같은
// URL 두 번 clone 해도 충돌 안 함.

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";

const execFile = promisify(execFileCb);

export class CloneError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "CloneError";
  }
}

export interface CloneResult {
  /** clone 된 절대 경로. project.path 로 박힘. */
  path: string;
}

/** URL → 디폴트 폴더명. UI 가 fallback 으로 사용. 사용자가 override 가능. */
export function inferRepoName(url: string): string {
  // 마지막 슬래시 이후, .git 떼고. 빈 값이면 "repo".
  const last = url.split("/").pop() ?? "";
  const cleaned = last.replace(/\.git$/i, "").trim();
  return cleaned || "repo";
}

/** git URL 형태인지 가벼운 검증 — http(s):// , git@host:path , ssh:// , file://,
 *  로컬 절대 경로 (file: protocol 없이) 도 허용 (git 자체가 받음).
 *  너무 빡빡하면 사용자 친화적이지 않으니 명백히 잘못된 것만 거름. */
export function isPlausibleGitUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^https?:\/\/\S+/i.test(s)) return true;
  if (/^git@\S+:\S+/i.test(s)) return true;
  if (/^ssh:\/\/\S+/i.test(s)) return true;
  if (/^git:\/\/\S+/i.test(s)) return true;
  if (/^file:\/\/\S+/i.test(s)) return true;
  // 로컬 path — git clone 이 받아주므로 같이 허용. 절대경로만.
  if (s.startsWith("/")) return true;
  return false;
}

/** projectId 를 디렉터리명으로 사용해 clone. 경로가 이미 존재하면 던짐 — 같은
 *  id 를 두 번 만들 일은 없지만 방어. */
export async function cloneRepo(
  projectId: string,
  url: string,
): Promise<CloneResult> {
  if (!isPlausibleGitUrl(url)) {
    throw new CloneError("invalid_url", "");
  }
  fs.mkdirSync(paths.repos, { recursive: true });
  const dest = path.join(paths.repos, projectId);
  if (fs.existsSync(dest)) {
    throw new CloneError("dest_exists", `dest already exists: ${dest}`);
  }
  try {
    // --no-tags 로 가벼움. depth 는 안 잘라 — 사용자가 history 보고 싶을 수도.
    // GIT_TERMINAL_PROMPT=0 으로 자격증명 프롬프트가 서버에 떠서 hang 하는 거 방지.
    const { stderr } = await execFile(
      "git",
      ["clone", "--no-tags", url, dest],
      {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        // clone 은 큰 레포면 시간 걸림 — 30분까지 허용. 더 넘으면 사용자가 그
        // 사이즈는 ssh-agent / credential 문제로 봐야.
        timeout: 30 * 60_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    // git clone 성공도 stderr 에 진행 메시지 — 그래도 dest 폴더가 만들어졌으면 OK.
    if (!fs.existsSync(path.join(dest, ".git"))) {
      throw new CloneError("clone_no_git_dir", stderr);
    }
    return { path: dest };
  } catch (err) {
    // 실패 시 부분 clone 디렉터리 정리 — 다음 시도 깔끔하게.
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (err instanceof CloneError) throw err;
    const e = err as { stderr?: string; message?: string };
    throw new CloneError(e.message ?? "clone_failed", (e.stderr ?? "").toString());
  }
}

/** loom 이 clone 한 디렉터리면 정리 (project 삭제 시).
 *  사용자가 직접 추가한 로컬 path 면 절대 안 건드림. */
export function removeClonedRepo(projectId: string): void {
  const dest = path.join(paths.repos, projectId);
  if (!fs.existsSync(dest)) return;
  // dest 가 paths.repos 의 직접 자식 인지 확인 — symlink trick 등 방지.
  const real = fs.realpathSync(dest);
  const reposReal = fs.realpathSync(paths.repos);
  if (path.dirname(real) !== reposReal) return;
  fs.rmSync(dest, { recursive: true, force: true });
}
