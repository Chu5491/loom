// VS Code 스타일 ⌘P 빠른 열기 팔레트.
// cmdk가 키보드 내비/포커스 트랩/포털/퍼지 매칭을 모두 처리 — 우리는 데이터만 제공.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { FileText, Search } from "lucide-react";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { basename, dirOf } from "../lib/path.js";

const MAX_RESULTS = 100;

export function FilePalette({
  projectId,
  open,
  onClose,
  onPickFile,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();

  // 첫 open에서 1회 fetch + 30초 stale.
  const filesQuery = useQuery({
    queryKey: ["projectFilesFlat", projectId],
    queryFn: () => api.getProjectFilesFlat(projectId),
    enabled: open,
    staleTime: 30_000,
  });
  const all = filesQuery.data?.paths ?? [];
  const visible = all.slice(0, MAX_RESULTS);

  // ESC로 닫기는 cmdk가 처리하지만 onOpenChange를 명시해야 부모 상태와 동기화됨.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      label={t("palette.title")}
      overlayClassName="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[15vh] -translate-x-1/2 z-50 w-[min(640px,90vw)] rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Search className="size-4 text-muted-foreground shrink-0" />
        <Command.Input
          placeholder={t("palette.placeholder")}
          className="flex-1 bg-transparent border-0 px-0 py-1 text-sm focus:outline-none focus:ring-0"
        />
        <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
          {filesQuery.isLoading
            ? "…"
            : t("palette.indexed", { n: all.length })}
        </span>
      </div>
      <Command.List className="max-h-[50vh] overflow-y-auto">
        {filesQuery.isLoading ? (
          <p className="px-3 py-4 text-sm text-muted-foreground italic">
            {t("common.loading")}
          </p>
        ) : (
          <Command.Empty className="px-3 py-4 text-sm text-muted-foreground italic">
            {t("palette.empty")}
          </Command.Empty>
        )}
        {visible.map((path) => (
          <Command.Item
            key={path}
            value={path}
            onSelect={() => {
              onPickFile(path);
              onClose();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer aria-selected:bg-muted hover:bg-muted/60"
          >
            <FileText className="size-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">{basename(path)}</span>
            <span className="text-xs text-muted-foreground/70 mono truncate ml-2">
              {dirOf(path)}
            </span>
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
