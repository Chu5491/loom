// gh pr create 래퍼 다이얼로그.
//
// title 은 현재 브랜치의 마지막 커밋 subject 로 prefill, body 는 origin/<base>
// 와의 diff stat 으로 채움. base branch 는 사용자가 고를 수 있게 하지만 default
// 는 가장 흔한 main / master / develop 자동 추천.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { GitPullRequest, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import { useI18n } from "../../context/I18nContext.js";

export function CreatePrDialog({
  open,
  onOpenChange,
  projectId,
  currentBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentBranch: string | null;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();

  const branches = useQuery({
    queryKey: ["gitBranches", projectId],
    queryFn: () => api.getGitBranches(projectId),
    enabled: open,
    retry: false,
  });

  // 가장 최근 커밋 subject — title prefill 용.
  const log = useQuery({
    queryKey: ["gitLog", projectId, { all: true }],
    queryFn: () => api.getGitLog(projectId!, { limit: 1, all: false }),
    enabled: open,
    retry: false,
  });

  const remoteBranches = useMemo(
    () =>
      (branches.data?.branches ?? []).filter((b) => b.kind === "remote"),
    [branches.data?.branches],
  );

  // base 자동 추천 — origin/main → origin/master → origin/develop 순.
  const defaultBase = useMemo(() => {
    const names = remoteBranches.map((b) => b.name);
    for (const candidate of ["origin/main", "origin/master", "origin/develop"]) {
      if (names.includes(candidate)) return candidate.replace(/^[^/]+\//, "");
    }
    return "";
  }, [remoteBranches]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [draft, setDraft] = useState(false);

  // open 될 때마다 prefill — 닫혀있을 땐 사용자 입력 보존 안 해도 됨.
  useEffect(() => {
    if (!open) return;
    setTitle(log.data?.entries[0]?.subject ?? "");
    setBody("");
    setBase(defaultBase);
    setDraft(false);
  }, [open, log.data?.entries, defaultBase]);

  const create = useMutation({
    mutationFn: () =>
      api.gitCreatePr(projectId, {
        title: title.trim(),
        body: body.trim(),
        base: base.trim() || undefined,
        draft,
      }),
    onSuccess: (r) => {
      toast.success(t("git.pr.created"), {
        description: r.url,
        action: r.url
          ? {
              label: t("git.pr.open"),
              onClick: () => window.open(r.url, "_blank"),
            }
          : undefined,
      });
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = (err as Error).message;
      if (msg.includes("gh_not_installed")) {
        toast.error(t("git.pr.ghMissing"));
      } else {
        toast.error(msg);
      }
    },
  });

  const canSubmit = title.trim().length > 0 && !create.isPending;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="pr-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
            onClick={() => !create.isPending && onOpenChange(false)}
          />
          <motion.div
            key="pr-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-[10vh] z-50 w-[min(640px,92vw)] -translate-x-1/2 rounded-lg border bg-popover shadow-2xl outline-none flex flex-col max-h-[80vh]"
          >
            <header className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
              <GitPullRequest className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold flex-1">
                {t("git.pr.title")}
              </h2>
              <button
                type="button"
                onClick={() => !create.isPending && onOpenChange(false)}
                aria-label={t("common.close")}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 subtle-scrollbar">
              <div className="text-[11px] text-muted-foreground mono">
                {currentBranch ? (
                  <span>
                    <span className="text-foreground/80">{currentBranch}</span>
                    {" → "}
                    <span className="text-foreground/80">
                      {base || t("git.pr.basePlaceholder")}
                    </span>
                  </span>
                ) : null}
              </div>
              <Field label={t("git.pr.titleField")}>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("git.pr.titlePlaceholder")}
                  disabled={create.isPending}
                />
              </Field>
              <Field label={t("git.pr.body")}>
                <Textarea
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("git.pr.bodyPlaceholder")}
                  className="mono text-[12px] resize-y"
                  disabled={create.isPending}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("git.pr.base")}>
                  <Input
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder={t("git.pr.basePlaceholder")}
                    list="git-pr-base-suggestions"
                    disabled={create.isPending}
                  />
                  <datalist id="git-pr-base-suggestions">
                    {remoteBranches.map((b) => {
                      const short = b.name.replace(/^[^/]+\//, "");
                      return <option key={b.name} value={short} />;
                    })}
                  </datalist>
                </Field>
                <Field label={t("git.pr.draftLabel")}>
                  <label className="inline-flex items-center gap-2 h-9 text-xs">
                    <input
                      type="checkbox"
                      checked={draft}
                      onChange={(e) => setDraft(e.target.checked)}
                      disabled={create.isPending}
                      className="size-4"
                    />
                    {t("git.pr.draftHint")}
                  </label>
                </Field>
              </div>
            </div>
            <footer className="flex items-center justify-end gap-2 p-3 border-t border-border shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => create.mutate()}
                disabled={!canSubmit}
              >
                {create.isPending ? t("git.pr.creating") : t("git.pr.create")}
              </Button>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
