// 스레드 컨텍스트 번들 편집 드로어. vaul Drawer.Root + 우측 슬라이드.
// vaul이 backdrop / focus trap / scroll lock / esc 처리 모두 흡수 — 직접 작성하던
// keyboard listener / backdrop click 핸들러 / focus restore 로직 사라짐.
//
// 컨텍스트 번들은 사용자가 손으로 유지하는 평문 마크다운 — 메모/배경/링크/스크래치패드.
// 자동 주입 절대 안 함; composer의 "컨텍스트 첨부" 토글이 유일 경로.
// 저장은 close 시점 (디바운스 X) — 타이핑 중에는 네트워크 조용히, close에는 즉각.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "vaul";
import { Paperclip, X } from "lucide-react";
import type { Thread } from "@loom/core";
import { api } from "../api/client.js";
import { Button } from "./ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export function ContextDrawer({
  open,
  thread,
  onClose,
}: {
  open: boolean;
  thread: Thread | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(thread?.contextBundle ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 활성 thread가 바뀌거나 open될 때마다 draft 재동기화. 다른 thread 편집을 덮어쓰지 않도록
  // boundId로 source thread 추적.
  const [boundId, setBoundId] = useState<string | null>(thread?.id ?? null);
  useEffect(() => {
    if (thread?.id !== boundId) {
      setDraft(thread?.contextBundle ?? "");
      setBoundId(thread?.id ?? null);
    }
  }, [thread, boundId]);

  // 드로어가 열리면 textarea에 자동 포커스.
  useEffect(() => {
    if (open && thread) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open, thread]);

  const save = useMutation({
    mutationFn: (input: { id: string; contextBundle: string }) =>
      api.updateThread(input.id, { contextBundle: input.contextBundle }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["thread", vars.id] });
    },
  });

  const dirty = thread ? draft !== thread.contextBundle : false;

  const commitAndClose = () => {
    if (thread && dirty) {
      save.mutate({ id: thread.id, contextBundle: draft });
    }
    onClose();
  };

  if (!thread) return null;
  const charCount = draft.length;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) commitAndClose();
      }}
      direction="right"
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/20 data-[state=open]:animate-fade-in" />
        <Drawer.Content
          aria-label={t("context.drawer.title")}
          className="fixed right-0 top-0 bottom-0 z-50 w-[min(540px,90vw)] flex flex-col border-l bg-background shadow-2xl outline-none"
        >
          <Drawer.Title className="sr-only">
            {t("context.drawer.title")}
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            {t("context.drawer.hint")}
          </Drawer.Description>

          <header className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
            <Paperclip className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold truncate">
                {t("context.drawer.title")}
              </h2>
              <p className="text-[11px] text-muted-foreground truncate">
                {thread.name}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground/70 mono shrink-0">
              {t("context.drawer.chars", { n: charCount })}
            </span>
            <button
              type="button"
              onClick={commitAndClose}
              title={t("context.drawer.close")}
              aria-label={t("context.drawer.close")}
              className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 min-h-0 flex flex-col">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("context.drawer.placeholder")}
              className="flex-1 min-h-0 resize-none bg-transparent border-0 px-4 py-3 text-sm mono leading-relaxed focus:outline-none focus:ring-0"
            />
          </div>

          <footer className="flex items-center justify-between gap-2 px-4 py-2 border-t shrink-0 bg-muted/20">
            <p className="text-[11px] text-muted-foreground/80">
              {t("context.drawer.hint")}
            </p>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[11px] mono",
                  dirty
                    ? "text-warning"
                    : "text-muted-foreground/60",
                )}
              >
                {save.isPending
                  ? t("context.drawer.saving")
                  : dirty
                    ? t("context.drawer.unsaved")
                    : t("context.drawer.saved")}
              </span>
              <Button size="sm" onClick={commitAndClose} className="h-7">
                {t("context.drawer.done")}
              </Button>
            </div>
          </footer>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
