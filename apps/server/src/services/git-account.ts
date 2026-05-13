// GitHub 계정 연동 — `gh` CLI 를 래핑해 인증 상태, 레포, 조직 조회.
// loom 은 자격증명을 직접 저장하지 않음 — gh auth 가 관리하는 토큰에 위임.

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { GitAuthStatus, GitOrg, GitRepo } from "@loom/core";

const execFile = promisify(execFileCb);

async function ghInstalled(): Promise<boolean> {
  try {
    await execFile("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function getAuthStatus(): Promise<GitAuthStatus> {
  if (!(await ghInstalled())) {
    return { authenticated: false, provider: "unknown", username: null, ghInstalled: false };
  }
  try {
    const { stdout } = await execFile("gh", ["auth", "status", "--show-token"], {
      env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
      timeout: 10_000,
    });
    const userMatch = stdout.match(/Logged in to \S+ account (\S+)/i)
      ?? stdout.match(/Logged in to \S+ as (\S+)/i);
    const username = userMatch?.[1]?.replace(/\s*\(.*\)/, "") ?? null;
    const isGitLab = stdout.toLowerCase().includes("gitlab");
    return {
      authenticated: true,
      provider: isGitLab ? "gitlab" : "github",
      username,
      ghInstalled: true,
    };
  } catch (err) {
    const stderr = ((err as { stderr?: string }).stderr ?? "").toString();
    if (stderr.includes("not logged") || stderr.includes("no oauth") || stderr.includes("authentication")) {
      return { authenticated: false, provider: "github", username: null, ghInstalled: true };
    }
    return { authenticated: false, provider: "unknown", username: null, ghInstalled: true };
  }
}

export async function listRepos(opts: {
  org?: string;
  limit?: number;
  sort?: "updated" | "name" | "stars";
}): Promise<GitRepo[]> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const sort = opts.sort ?? "updated";
  const args = [
    "repo",
    "list",
    ...(opts.org ? [opts.org] : []),
    "--json", "nameWithOwner,description,url,sshUrl,isPrivate,defaultBranchRef,updatedAt",
    "--limit", String(limit),
    "--sort", sort,
  ];
  try {
    const { stdout } = await execFile("gh", args, {
      env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
      timeout: 30_000,
    });
    const raw = JSON.parse(stdout) as Array<{
      nameWithOwner: string;
      description: string | null;
      url: string;
      sshUrl: string;
      isPrivate: boolean;
      defaultBranchRef: { name: string } | null;
      updatedAt: string;
    }>;
    return raw.map((r) => ({
      nameWithOwner: r.nameWithOwner,
      description: r.description,
      url: r.url,
      sshUrl: r.sshUrl,
      isPrivate: r.isPrivate,
      defaultBranch: r.defaultBranchRef?.name ?? "main",
      updatedAt: r.updatedAt,
    }));
  } catch {
    return [];
  }
}

export async function listOrgs(): Promise<GitOrg[]> {
  try {
    const { stdout } = await execFile(
      "gh",
      ["org", "list", "--limit", "50"],
      {
        env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
        timeout: 15_000,
      },
    );
    // gh org list 는 JSON 출력을 지원하지 않음 — 줄 단위 파싱.
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((login) => ({ login: login.trim(), description: null }));
  } catch {
    return [];
  }
}

export async function searchRepos(query: string, limit = 20): Promise<GitRepo[]> {
  const args = [
    "search", "repos",
    query,
    "--json", "nameWithOwner,description,url,isPrivate,defaultBranch,updatedAt",
    "--limit", String(Math.min(limit, 50)),
  ];
  try {
    const { stdout } = await execFile("gh", args, {
      env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
      timeout: 15_000,
    });
    const raw = JSON.parse(stdout) as Array<{
      nameWithOwner: string;
      description: string | null;
      url: string;
      isPrivate: boolean;
      defaultBranch: string;
      updatedAt: string;
    }>;
    return raw.map((r) => ({
      nameWithOwner: r.nameWithOwner,
      description: r.description,
      url: r.url,
      sshUrl: `git@github.com:${r.nameWithOwner}.git`,
      isPrivate: r.isPrivate,
      defaultBranch: r.defaultBranch ?? "main",
      updatedAt: r.updatedAt,
    }));
  } catch {
    return [];
  }
}
