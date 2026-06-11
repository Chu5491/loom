// 파일 뷰 — 프로젝트 디렉토리 트리 + Monaco 뷰어(읽기 전용).
// 트리는 펼친 폴더만 lazy 로 불러온다(거대 레포 안전).

import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, File as FileIcon, FolderClosed, FolderOpen } from "lucide-react";
import type { Project } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const CodeViewer = lazy(() => import("./Code.js").then((m) => ({ default: m.CodeViewer })));

export function FilesView({ project }: { project: Project }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const file = useQuery({
    queryKey: ["pfile", project.id, selected],
    queryFn: () => api.projectFile(project.id, selected!),
    enabled: !!selected,
  });

  return (
    <div className="flex h-full min-w-0 flex-1 gap-0 py-4">
      {/* 트리 */}
      <div className="w-64 shrink-0 overflow-y-auto rounded-l-2xl border border-border bg-card/60 p-2">
        <DirNode project={project} path="." depth={0} selected={selected} onSelect={setSelected} />
      </div>
      {/* 뷰어 */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-r-2xl border border-l-0 border-border bg-card">
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
              <FileIcon className="size-3.5 text-primary" />
              <span className="truncate font-mono text-xs">{selected}</span>
            </div>
            <div className="min-h-0 flex-1">
              {file.data ? (
                <Suspense fallback={<Loading t={t} />}>
                  <CodeViewer path={selected} value={file.data.content} />
                </Suspense>
              ) : file.isError ? (
                <p className="p-4 text-sm text-destructive">{(file.error as Error).message}</p>
              ) : (
                <Loading t={t} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("files.pick")}
          </div>
        )}
      </div>
    </div>
  );
}

function Loading({ t }: { t: (k: never) => string }) {
  return <p className="p-4 text-sm text-muted-foreground">{(t as (k: string) => string)("common.checking")}</p>;
}

// 디렉토리 노드 — 펼치면 그때 자식을 fetch.
function DirNode({
  project,
  path,
  depth,
  selected,
  onSelect,
}: {
  project: Project;
  path: string;
  depth: number;
  selected: string | null;
  onSelect: (p: string) => void;
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
            <DirNode key={d.path} project={project} path={d.path} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
          {tree.data.files.map((f) => (
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
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
