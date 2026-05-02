// 채팅 도구 스트립용 파일 칩.
// READ/WRITE/EDIT 도구가 만진 파일을 클릭 가능한 칩으로 표현.
// 클릭 시 loomEvents의 openFile로 워크스페이스가 받아 에디터로 점프.

import { Eye, FileEdit, FilePlus2 } from "lucide-react";
import type { FileToolKind } from "./utils.js";
import { basename } from "../../lib/path.js";
import { emit } from "../../lib/loomEvents.js";
import { cn } from "../../lib/utils.js";

const ICON: Record<FileToolKind, typeof Eye> = {
  read: Eye,
  write: FilePlus2,
  edit: FileEdit,
};

export function FileToolChip({
  kind,
  path,
  live,
}: {
  kind: FileToolKind;
  path: string;
  /** 진행중인 마지막 도구일 때 — 챕에 펄스를 입혀 살아있음을 표시. */
  live?: boolean;
}) {
  const Icon = ICON[kind];
  return (
    <button
      type="button"
      onClick={() => emit("openFile", { path })}
      title={path}
      className={cn(
        "group inline-flex items-center gap-1 px-1.5 h-5 rounded border bg-background text-[11px] mono whitespace-nowrap shrink-0 transition-colors",
        live
          ? "border-foreground/40 ring-1 ring-foreground/15 animate-pulse"
          : "border-border/60 hover:bg-muted hover:border-foreground/30",
      )}
    >
      <Icon className="size-3 opacity-70 group-hover:opacity-100" />
      <span>{basename(path)}</span>
    </button>
  );
}
