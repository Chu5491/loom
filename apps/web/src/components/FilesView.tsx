// 파일 뷰 — 프로젝트 디렉토리 트리 + Monaco 뷰어/Diff.
// 트리는 펼친 폴더만 lazy 로 불러오고(거대 레포 안전), 에이전트가 건드린 파일엔
// 누가 바꿨는지 배지가 붙는다. 파일을 열면 [코드 | Diff] 토글로 HEAD 대비 변경을 본다.

import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, File as FileIcon, FolderClosed, FolderOpen, GitCompareArrows } from "lucide-react";
import type { AdapterKind, Project } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const CodeViewer = lazy(() => import("./Code.js").then((m) => ({ default: m.CodeViewer })));
const CodeDiff = lazy(() => import("./Code.js").then((m) => ({ default: m.CodeDiff })));

// run 이벤트의 파일 경로는 절대경로일 수 있음 — 프로젝트 기준 상대로(/private 별칭 흡수).
function relativize(p: string, root: string): string {
  const norm = root.endsWith("/") ? root : root + "/";
  if (p.startsWith(norm)) return p.slice(norm.length);
  const privNorm = "/private" + norm;
  if (p.startsWith(privNorm)) return p.slice(privNorm.length);
  return p;
}

export function FilesView({ project }: { project: Project }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"code" | "diff">("code");
  const [panel, setPanel] = useState<"tree" | "changes">("tree");

  // 변경 개요(리뷰 보드) — 작업트리의 바뀐 파일 + 파일별 +N/-M. 5초 폴링(작업 중 반영).
  const changes = useQuery({
    queryKey: ["gitchanges", project.id],
    queryFn: () => api.gitChanges(project.id),
    refetchInterval: panel === "changes" ? 5_000 : false,
    enabled: panel === "changes",
  });

  const file = useQuery({
    queryKey: ["pfile", project.id, selected],
    queryFn: () => api.projectFile(project.id, selected!),
    enabled: !!selected && mode === "code",
  });
  const versions = useQuery({
    queryKey: ["gitv", project.id, selected],
    queryFn: () => api.gitVersions(project.id, selected!),
    enabled: !!selected && mode === "diff",
  });
  const activity = useQuery({
    queryKey: ["activity", project.id],
    queryFn: () => api.agentActivity(project.id),
    refetchInterval: 10_000,
  });
  const agentsQ = useQuery({ queryKey: ["office"], queryFn: api.getOffice });

  // 파일별 "누가 바꿨나" — 최근 활동 우선, 에이전트 중복 제거.
  const changedBy = useMemo(() => {
    const m = new Map<string, { agent: string; action: "edit" | "write" }[]>();
    for (const a of activity.data?.activity ?? []) {
      for (const f of a.files) {
        const rel = relativize(f.path, project.path);
        const list = m.get(rel) ?? [];
        if (!list.some((x) => x.agent === a.agent)) list.push({ agent: a.agent, action: f.action });
        m.set(rel, list);
      }
    }
    return m;
  }, [activity.data, project.path]);
  const adapterOf = (name: string) => agentsQ.data?.office.agents.find((a) => a.name === name)?.adapter;

  const editors = selected ? changedBy.get(selected) ?? [] : [];

  const changeCount = changes.data?.changes.length ?? changedBy.size;

  return (
    <div className="flex h-full min-w-0 flex-1 gap-0 py-4">
      {/* 좌측 패널 — [트리 | 변경] 토글 */}
      <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-l-2xl border border-border bg-card/60">
        <div className="flex shrink-0 gap-1 border-b border-border/60 p-1.5">
          {(["tree", "changes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPanel(v)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                panel === v ? "bg-primary/15 text-foreground shadow-[var(--shadow-glow-sm)]" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {v === "tree" ? <FolderClosed className="size-3" /> : <GitCompareArrows className="size-3" />}
              {t(`files.panel.${v}`)}
              {v === "changes" && changeCount > 0 ? (
                <span className="rounded-full bg-primary/20 px-1 text-[9px] tabular-nums text-primary">{changeCount}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {panel === "tree" ? (
            <DirNode
              project={project}
              path="."
              depth={0}
              selected={selected}
              onSelect={(p) => { setSelected(p); setMode("code"); }}
              changedBy={changedBy}
              adapterOf={adapterOf}
            />
          ) : (
            <ChangesBoard
              changes={changes.data?.changes ?? []}
              loading={changes.isLoading}
              notRepo={changes.data?.git === false}
              changedBy={changedBy}
              adapterOf={adapterOf}
              selected={selected}
              onSelect={(p) => { setSelected(p); setMode("diff"); }}
            />
          )}
        </div>
      </div>
      {/* 뷰어 / Diff */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-r-2xl border border-l-0 border-border bg-card">
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2">
              {/* 경로 브레드크럼 — 마지막 세그먼트만 강조 */}
              <FileIcon className="size-3.5 shrink-0 text-primary" />
              <span className="flex min-w-0 items-center gap-1 truncate font-mono text-xs">
                {selected.split("/").map((seg, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-muted-foreground/40">/</span> : null}
                    <span className={i === arr.length - 1 ? "text-foreground" : "text-muted-foreground"}>{seg}</span>
                  </span>
                ))}
              </span>
              {selected.includes(".") ? (
                <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                  {selected.split(".").pop()}
                </span>
              ) : null}
              {/* 이 파일을 바꾼 에이전트들 */}
              {editors.map((e) => {
                const adapter = adapterOf(e.agent);
                return adapter ? (
                  <span key={e.agent} title={`${e.agent} (${e.action})`} className="flex items-center">
                    <AgentAvatar adapter={adapter} size={18} className="rounded-md" />
                  </span>
                ) : null;
              })}
              <div className="ml-auto inline-flex shrink-0 gap-1">
                {(["code", "diff"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all",
                      mode === m
                        ? "bg-primary/15 text-foreground shadow-[var(--shadow-glow-sm)]"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {m === "diff" ? <GitCompareArrows className="size-3" /> : <FileIcon className="size-3" />}
                    {t(`files.${m}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {mode === "code" ? (
                file.data ? (
                  <Suspense fallback={<Hint text={t("common.checking")} />}>
                    <CodeViewer path={selected} value={file.data.content} />
                  </Suspense>
                ) : file.isError ? (
                  <p className="p-4 text-sm text-destructive">{(file.error as Error).message}</p>
                ) : (
                  <Hint text={t("common.checking")} />
                )
              ) : versions.data ? (
                versions.data.head === versions.data.working ? (
                  <Hint text={t("files.noDiff")} />
                ) : (
                  <Suspense fallback={<Hint text={t("common.checking")} />}>
                    <CodeDiff path={selected} original={versions.data.head ?? ""} modified={versions.data.working ?? ""} />
                  </Suspense>
                )
              ) : (
                <Hint text={t("common.checking")} />
              )}
            </div>
          </div>
        ) : (
          <Hint text={t("files.pick")} />
        )}
      </div>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">{text}</div>;
}

// 변경 리뷰 보드 — 바뀐 파일 + action 색 + +N/-M 통계 + 바꾼 에이전트. 클릭 → diff.
type Change = { path: string; action: "add" | "edit" | "delete"; added: number; removed: number };
const ACTION_TONE: Record<Change["action"], string> = {
  add: "bg-success",
  edit: "bg-warning",
  delete: "bg-destructive",
};
function ChangesBoard({
  changes, loading, notRepo, changedBy, adapterOf, selected, onSelect,
}: {
  changes: Change[];
  loading: boolean;
  notRepo?: boolean;
  changedBy: Map<string, { agent: string; action: "edit" | "write" }[]>;
  adapterOf: (name: string) => AdapterKind | undefined;
  selected: string | null;
  onSelect: (p: string) => void;
}) {
  const { t } = useI18n();
  if (notRepo) return <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">{t("files.changes.notRepo")}</p>;
  if (loading && changes.length === 0) return <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">{t("common.checking")}</p>;
  if (changes.length === 0) return <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">{t("files.changes.none")}</p>;

  const total = changes.reduce((a, c) => ({ added: a.added + c.added, removed: a.removed + c.removed }), { added: 0, removed: 0 });
  return (
    <div className="space-y-0.5">
      {/* 합계 — 이 작업으로 바뀐 전체 규모 */}
      <div className="mb-1.5 flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
        <span>{t("files.changes.summary", { n: String(changes.length) })}</span>
        <span className="ml-auto font-mono">
          <span className="text-success">+{total.added}</span> <span className="text-destructive">-{total.removed}</span>
        </span>
      </div>
      {changes.map((c) => {
        const editors = changedBy.get(c.path) ?? [];
        return (
          <button
            key={c.path}
            type="button"
            onClick={() => onSelect(c.path)}
            className={cn(
              "group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
              selected === c.path ? "bg-primary/15" : "hover:bg-muted/60",
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", ACTION_TONE[c.action])} title={c.action} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11px] text-foreground">{c.path.split("/").pop()}</span>
              {c.path.includes("/") ? (
                <span className="block truncate font-mono text-[9px] text-muted-foreground/70">{c.path.slice(0, c.path.lastIndexOf("/"))}</span>
              ) : null}
            </span>
            {/* 바꾼 에이전트 마이크로 아바타 */}
            {editors.slice(0, 2).map((e) => {
              const ad = adapterOf(e.agent);
              return ad ? <AgentAvatar key={e.agent} adapter={ad} size={13} className="shrink-0 rounded" /> : null;
            })}
            <span className="shrink-0 font-mono text-[9px] tabular-nums">
              {c.added > 0 ? <span className="text-success">+{c.added}</span> : null}
              {c.removed > 0 ? <span className="ml-0.5 text-destructive">-{c.removed}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// 디렉토리 노드 — 펼치면 그때 자식을 fetch. 파일엔 변경 에이전트 배지.
function DirNode({
  project,
  path,
  depth,
  selected,
  onSelect,
  changedBy,
  adapterOf,
}: {
  project: Project;
  path: string;
  depth: number;
  selected: string | null;
  onSelect: (p: string) => void;
  changedBy: Map<string, { agent: string; action: "edit" | "write" }[]>;
  adapterOf: (name: string) => AdapterKind | undefined;
}) {
  const [open, setOpen] = useState(depth === 0);
  const tree = useQuery({
    queryKey: ["ptree", project.id, path],
    queryFn: () => api.projectTree(project.id, path),
    enabled: open,
    staleTime: 15_000,
  });

  return (
    <div>
      {depth > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          style={{ paddingLeft: depth * 12 }}
        >
          {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          {open ? <FolderOpen className="size-3.5 shrink-0 text-primary/70" /> : <FolderClosed className="size-3.5 shrink-0" />}
          <span className="truncate">{path.split("/").pop()}</span>
        </button>
      ) : null}
      {open && tree.data ? (
        <div>
          {tree.data.dirs.map((d) => (
            <DirNode key={d.path} project={project} path={d.path} depth={depth + 1} selected={selected} onSelect={onSelect} changedBy={changedBy} adapterOf={adapterOf} />
          ))}
          {tree.data.files.map((f) => {
            const editors = changedBy.get(f.path) ?? [];
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => onSelect(f.path)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-mono text-[11px] transition-colors",
                  selected === f.path ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                style={{ paddingLeft: (depth + 1) * 12 + 4 }}
              >
                <FileIcon className="size-3 shrink-0 opacity-60" />
                <span className="truncate">{f.name}</span>
                {/* 에이전트가 바꾼 파일 — 누가 바꿨는지 마이크로 아바타 */}
                {editors.length > 0 ? (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5">
                    {editors.slice(0, 3).map((e) => {
                      const adapter = adapterOf(e.agent);
                      return adapter ? (
                        <span key={e.agent} title={`${e.agent} (${e.action})`}>
                          <AgentAvatar adapter={adapter} size={14} className="rounded" />
                        </span>
                      ) : null;
                    })}
                    <span className={cn("size-1.5 rounded-full", editors.some((e) => e.action === "edit") ? "bg-warning" : "bg-success")} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
