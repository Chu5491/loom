import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  createProject,
  createProjectWithId,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../db/projects.js";
import {
  cloneRepo,
  CloneError,
  inferRepoName,
  removeClonedRepo,
} from "../services/project-clone.js";
import {
  listProjectEnv,
  replaceProjectEnv,
} from "../db/project-env.js";
import { listFileHistoryHydrated, listTouchedPaths } from "../db/run-changes.js";
import { listActiveRunsByProject } from "../db/runs.js";
import { listDelegationsForRuns } from "../db/delegations.js";
import { getProjectInsights } from "../db/insights.js";
import { listForProject as listActiveTouches } from "../services/active-touches.js";
import { listToolsForProject } from "../services/active-tools.js";
import { listAllFiles, listTree, readProjectFile } from "../services/project-fs.js";
import { openInEditor } from "../services/open-in-editor.js";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

const editorSchema = z.enum([
  "vscode",
  "cursor",
  "antigravity",
  "zed",
  "intellij",
]);

// 두 모드 — local path 또는 git clone. 둘 중 하나만 명시. 둘 다 없으면 invalid.
const createSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1).optional(),
    cloneUrl: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    preferredEditor: editorSchema.nullable().optional(),
  })
  .refine((v) => !!v.path || !!v.cloneUrl, {
    message: "path or cloneUrl is required",
  });

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  preferredEditor: editorSchema.nullable().optional(),
});

export const projectsRoute = new Hono();

projectsRoute.get("/", (c) => c.json({ projects: listProjects() }));

projectsRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const data = parsed.data;

  // 1) Clone 모드 — projectId 를 미리 결정해 그 id 로 폴더 만들고, 성공하면 row.
  if (data.cloneUrl) {
    const id = randomUUID();
    let cloned;
    try {
      cloned = await cloneRepo(id, data.cloneUrl);
    } catch (err) {
      if (err instanceof CloneError) {
        return c.json(
          { error: "clone_failed", message: err.message, stderr: err.stderr },
          422,
        );
      }
      return c.json(
        { error: "clone_failed", message: (err as Error).message },
        500,
      );
    }
    try {
      const project = createProjectWithId(id, {
        name: data.name || inferRepoName(data.cloneUrl),
        path: cloned.path,
        description: data.description,
        preferredEditor: data.preferredEditor,
        cloneUrl: data.cloneUrl,
      });
      return c.json({ project }, 201);
    } catch (err) {
      // DB insert 실패 → clone 한 폴더 정리.
      removeClonedRepo(id);
      throw err;
    }
  }

  // 2) Local path 모드 — 기존 흐름 그대로.
  if (!data.path) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const project = createProject({
    name: data.name,
    path: data.path,
    description: data.description,
    preferredEditor: data.preferredEditor,
  });
  return c.json({ project }, 201);
});

projectsRoute.get("/:id", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ project });
});

projectsRoute.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const project = updateProject(c.req.param("id"), parsed.data);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ project });
});

projectsRoute.delete("/:id", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  const ok = deleteProject(id);
  if (!ok) return c.json({ error: "not_found" }, 404);
  // clone 으로 만든 프로젝트면 디스크의 clone 도 정리. 사용자가 직접 추가한
  // 로컬 path 면 절대 안 건드림.
  if (project.cloneUrl) {
    try {
      removeClonedRepo(id);
    } catch {
      // 디스크 정리는 best-effort — 실패해도 row 는 이미 지웠음.
    }
  }
  return c.body(null, 204);
});

/**
 * One directory level inside a project. Lazy on purpose — recursive trees
 * for large repos are huge. The web tree fetches children on expand.
 *
 *   GET /api/projects/:id/tree           → root entries
 *   GET /api/projects/:id/tree?path=src  → entries inside src/
 */
projectsRoute.get("/:id/tree", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const sub = c.req.query("path") ?? "";
  const result = await listTree(project.path, sub);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return c.json({ error: result.reason }, status);
  }
  return c.json({ entries: result.entries });
});

/**
 * Every file in this project that's been touched by an agent, with the
 * most recent toucher and time. The file tree uses this to decorate
 * touched files with a dot — at-a-glance "what's been worked on."
 */
projectsRoute.get("/:id/touched", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ paths: listTouchedPaths(project.path) });
});

/**
 * Project-level environment variables — shared between every agent run
 * in this project. Lower priority than agent.adapterConfig.env so agents
 * can override; higher priority than the OS env. Useful for shared API
 * keys, base URLs, etc.
 *
 *   GET /api/projects/:id/env       → { env: { K: V, … } }
 *   PUT /api/projects/:id/env body  → replaces the whole map
 */
projectsRoute.get("/:id/env", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ env: listProjectEnv(project.id) });
});

const envSchema = z.object({
  env: z.record(z.string(), z.string()),
});
projectsRoute.put("/:id/env", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = envSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  replaceProjectEnv(project.id, parsed.data.env);
  return c.json({ env: listProjectEnv(project.id) });
});

/**
 * Files that any currently-running agent is editing right *now*. Backed
 * by an in-memory store fed from CLI tool_use events; entries vanish
 * when the run finishes (run_changes takes over for past edits).
 *
 * The file tree polls this while a project has active runs and pulses
 * the matching rows so the user sees ambient progress without having
 * to scroll the chat.
 */
projectsRoute.get("/:id/active-touches", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ touches: listActiveTouches(id) });
});

/**
 * 진행 중(queued/running) 인 run 목록. 사용자가 프로젝트를 떠나려고 할 때
 * "지금 N개 돌고 있어요" 알림을 띄우기 위한 가벼운 카운트 + 본문.
 */
projectsRoute.get("/:id/active-runs", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ runs: listActiveRunsByProject(id) });
});

/**
 * 프로젝트 단위 통계 — 비용, 성공률, agent 별 시간, 파일 활동. 단일 응답이라
 * 대시보드 페이지가 한 번 호출로 모든 섹션을 그림.
 *
 *   ?windowDays=7|30|90  (default 30, clamp 1-365)
 */
projectsRoute.get("/:id/insights", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  const raw = Number(c.req.query("windowDays") ?? "30");
  const windowDays =
    Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.max(1, Math.floor(raw))) : 30;
  return c.json(getProjectInsights(id, windowDays));
});

/**
 * Tools each currently-running agent is reaching for. Companion to
 * /active-touches: touches answer "which file" and tools answer "which
 * tool / which MCP server". Office desks render this as the "what's on
 * the desk right now" indicator. Drains when the run finishes.
 */
projectsRoute.get("/:id/active-tools", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ tools: listToolsForProject(id) });
});

/**
 * 진행 중 run 들의 위임 (sub-agent Task 호출) 시도/결과 모음.
 * 라이브 뷰의 활동 스트림이 위임 표시를 위해 사용.
 *
 * Phase 1 에선 빈 응답이 정상 — 어댑터가 Task 이벤트를 아직 안 기록.
 * Phase 2 에서 어댑터별 Task tool 추출이 들어오면 자연스럽게 채워짐.
 */
projectsRoute.get("/:id/active-delegations", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  const runs = listActiveRunsByProject(id);
  const byParent = listDelegationsForRuns(runs.map((r) => r.id));
  const flat = [];
  for (const [, list] of byParent) {
    for (const d of list) flat.push(d);
  }
  return c.json({ delegations: flat });
});

/**
 * Every run that touched a given file in this project, newest first.
 * Each entry carries the run id, agent id (so the UI can show "@agent"),
 * status delta (added/modified/deleted), and line counts. Used by the
 * file viewer's "history" rail to bridge files ↔ chat.
 */
projectsRoute.get("/:id/file-history", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path_required" }, 400);

  // 단일 JOIN 쿼리 — 이전엔 N+1로 row마다 getRun+getAgent를 별도 호출했음.
  return c.json({ entries: listFileHistoryHydrated(project.path, path) });
});

/**
 * Flat list of every file in the project — powers Cmd+P file search.
 * Recursive walk respecting the same hidden-dir rules as the tree
 * endpoint, capped at 50k entries to keep payloads sane on huge
 * monorepos. Clients do their own fuzzy match against the list.
 */
projectsRoute.get("/:id/files-flat", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const paths = await listAllFiles(project.path);
  return c.json({ paths });
});

/**
 * Read a single file's contents. Refuses paths that escape the project
 * root, files > 2 MiB, or anything that isn't a regular file. Binary
 * files come back with text === null so the UI can render a placeholder.
 */
/**
 * Spawn the project's preferred external IDE pointed at a path inside the
 * project root. Body: `{ path?: string, line?: number, editor?: PreferredEditor }`.
 *   - `path` is project-relative (or empty/missing → opens project root)
 *   - `editor` overrides the project's saved preference for this call
 *   - resolves CLI binary on PATH; 404s if none of the candidates are
 *     installed so the UI can prompt the user to install the CLI launcher.
 */
const openSchema = z.object({
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  editor: editorSchema.optional(),
});

projectsRoute.post("/:id/open-in-editor", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }

  const editor = parsed.data.editor ?? project.preferredEditor ?? "vscode";

  // path 정규화 + 프로젝트 루트 탈출 차단. project-fs와 같은 규약.
  const projectRoot = resolve(project.path);
  const sub = parsed.data.path ?? "";
  const target = sub
    ? resolve(join(projectRoot, normalize(sub)))
    : projectRoot;
  if (!isAbsolute(target) || (target !== projectRoot && !target.startsWith(projectRoot + sep))) {
    return c.json({ error: "path_escape" }, 400);
  }

  const result = await openInEditor({
    target,
    line: parsed.data.line,
    editor,
  });
  if (!result.ok) {
    const status = result.reason === "no_cli_found" ? 404 : 400;
    return c.json({ error: result.reason, detail: result.detail }, status);
  }
  return c.json({ ok: true, editor, command: result.command });
});

projectsRoute.get("/:id/file", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path_required" }, 400);
  const result = await readProjectFile(project.path, path);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return c.json({ error: result.reason, size: result.size }, status);
  }
  return c.json({ file: result.file });
});
