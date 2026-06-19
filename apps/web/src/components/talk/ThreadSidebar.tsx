// 스레드 사이드바 — 대화 목록을 큼직하게 (lg+). hover 시 이름변경·삭제.

import type { Thread } from "@loom/core";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

export function ThreadSidebar({
  threads, threadId, renaming, onRenaming, onPick, onRename, onDelete,
}: {
  threads: Thread[];
  threadId: string | null;
  renaming: string | null;
  onRenaming: (id: string | null) => void;
  onPick: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto rounded-2xl glass-panel p-4 lg:flex">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("talk.sidebar.threads")}</h3>
        <button
          type="button"
          title={t("talk.thread.new")}
          onClick={() => onPick(null)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <MessageSquarePlus className="size-4" />
        </button>
      </div>
      <div className="space-y-0.5">
        {threadId === null ? (
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2.5 py-2 text-sm text-primary">
            {t("talk.thread.new")}
          </div>
        ) : null}
        {threads.map((th) => {
          const active = th.id === threadId;
          if (renaming === th.id) {
            return (
              <input
                key={th.id}
                className="w-full rounded-lg border border-primary/50 bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                defaultValue={th.name}
                autoFocus
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Escape") onRenaming(null);
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) onRename(th.id, v);
                    onRenaming(null);
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) onRename(th.id, v);
                  onRenaming(null);
                }}
              />
            );
          }
          return (
            <div
              key={th.id}
              className={cn(
                "group/th flex items-center gap-1 rounded-lg transition-colors",
                active ? "bg-primary/10" : "hover:bg-muted/50",
              )}
            >
              <button
                type="button"
                onClick={() => onPick(th.id)}
                className={cn("min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm", active ? "font-medium" : "text-muted-foreground")}
              >
                {th.name}
              </button>
              <button
                type="button"
                title={t("talk.thread.rename")}
                onClick={() => onRenaming(th.id)}
                className="shrink-0 p-1 text-muted-foreground/50 opacity-0 transition hover:text-primary group-hover/th:opacity-100"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                title={t("talk.thread.delete")}
                onClick={() => onDelete(th.id)}
                className="mr-1 shrink-0 p-1 text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover/th:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
