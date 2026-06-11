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

  return (
    <div className="flex h-full min-w-0 flex-1 gap-0 py-4">
      {/* 트리 */}
      <div className="w-64 shrink-0 overflow-y-auto rounded-l-2xl border border-border bg-card/60 p-2">
        <DirNode
          project={project}
          path="."
          depth={0}
          selected={selected}
          onSelect={(p) => { setSelected(p); setMode("code"); }}
          changedBy={changedBy}
          adapterOf={adapterOf}
        />
      </div>
      {/* 뷰어 / Diff */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-r-2xl border border-l-0 border-border bg-card">
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
              <FileIcon className="size-3.5 shrink-0 text-primary" />
              <span className="truncate font-mono text-xs">{selected}</span>
              {/* 이 파일을 바꾼 에이전트들 */}
              {editors.map((e) => {
                const adapter = adapterOf(e.agent);
                return adapter ? (
                  <span key={e.agent} title={`${e.agent} (${e.action})`} className="flex items-center">
                    <AgentAvatar adapter={adapter} size={18} className="rounded-md" />
                  </span>
                ) : null;
              })}
              <div className="ml-auto inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                {(["code", "diff"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                      mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
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
