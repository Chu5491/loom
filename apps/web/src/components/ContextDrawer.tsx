import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import type { Thread } from "@loom/core";
import { api } from "../api/client.js";
import { Button } from "./ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

/**
 * Slide-in editor for a thread's context bundle.
 *
 * The bundle is plain markdown the user maintains by hand — notes,
 * background, links, scratchpad. Nothing is auto-injected into runs;
 * the composer's "attach context" toggle is the only path that pulls
 * this content into a CLI invocation. That keeps loom's "user writes,
 * loom carries" promise intact while still giving them a *place* to
 * accumulate conversation context.
 *
 * Saves on close / blur (debounced) rather than per-keystroke — keeps
 * the network quiet during typing while still feeling immediate.
 */
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

  // Re-sync draft whenever the active thread changes or we open. We
  // track the source thread by id so flicking between threads doesn't
  // overwrite an in-flight edit on a different one.
  const [boundId, setBoundId] = useState<string | null>(thread?.id ?? null);
  useEffect(() => {
    if (thread?.id !== boundId) {
      setDraft(thread?.contextBundle ?? "");
      setBoundId(thread?.id ?? null);
    }
  }, [thread, boundId]);

  // Focus the textarea when the drawer opens — feels like the
  // editor's the whole point of the panel, no need for an extra click.
  useEffect(() => {
    if (open && thread) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open, thread]);

  // Esc to dismiss. Saves are handled at close-time (below) so Esc
  // never abandons typed content.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const save = useMutation({
    mutationFn: (input: { id: string; contextBundle: string }) =>
      api.updateThread(input.id, { contextBundle: input.contextBundle }),
    onSuccess: (_, vars) => {
      // Refresh the thread list so the composer's attach toggle and
      // the bar's "context · N chars" counter pick up the new value.
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

  if (!open || !thread) return null;

  const charCount = draft.length;
  return (
    <>
      {/* Backdrop — clicking it commits & closes. We deliberately
       *  don't dismiss without saving; surprise data loss is the
       *  worst kind of "trust me, it was just a click" UX. */}
      <div
        className="fixed inset-0 z-40 bg-foreground/20"
        onClick={commitAndClose}
      />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-[min(540px,90vw)] flex flex-col border-l bg-background shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("context.drawer.title")}
      >
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
                  ? "text-amber-600 dark:text-amber-400"
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
      </aside>
    </>
  );
}
