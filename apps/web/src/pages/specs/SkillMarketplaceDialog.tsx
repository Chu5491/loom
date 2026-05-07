// Skill 마켓플레이스 다이얼로그 — 큐레이팅된 starter skills.
// MCP 의 MarketplaceDialog 와 같은 패턴: 검색 + 카드 + Install 시 prefill 로
// /skills/new?from=<id> 로 navigate.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, FileText, Search, X } from "lucide-react";
import { api, type SkillMarketplaceEntry } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

export function SkillMarketplaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | "skills.sh" | "builtin">("all");

  const list = useQuery({
    queryKey: ["skill-marketplace", source],
    queryFn: () => api.listSkillMarketplace(source),
    enabled: open,
    staleTime: 60 * 60_000,
  });

  const entries = useMemo(() => {
    const all = list.data?.entries ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [list.data?.entries, query]);

  const onInstall = (entry: SkillMarketplaceEntry) => {
    onOpenChange(false);
    navigate(`/skills/new?from=${encodeURIComponent(entry.id)}`);
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-[8vh] z-50 w-[min(720px,92vw)] -translate-x-1/2 rounded-lg border bg-popover shadow-2xl outline-none flex flex-col max-h-[80vh]"
          >
            <header className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
              <FileText className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {t("specs.marketplace.title")}
              </h2>
              <span className="text-[11px] text-muted-foreground/70 mono">
                {entries.length}
              </span>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t("common.close")}
                className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </header>

            <div className="px-4 py-2.5 border-b border-border/60 shrink-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("specs.marketplace.searchPlaceholder")}
                  autoFocus
                  className="pl-7 h-8 text-sm"
                />
              </div>
              <SkillSourceTabs
                value={source}
                onChange={setSource}
                skillsShEnabled={!!list.data?.sources.skillsShEnabled}
              />
            </div>

            <div className="flex-1 overflow-y-auto subtle-scrollbar p-3 space-y-2">
              {list.isLoading ? (
                <p className="px-2 py-4 text-xs text-muted-foreground italic">
                  {t("common.loading")}
                </p>
              ) : entries.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground/70 italic">
                  {t("specs.marketplace.noMatch")}
                </p>
              ) : (
                entries.map((e) => (
                  <SkillCard
                    key={e.id}
                    entry={e}
                    onInstall={() => onInstall(e)}
                  />
                ))
              )}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function SkillSourceTabs({
  value,
  onChange,
  skillsShEnabled,
}: {
  value: "all" | "skills.sh" | "builtin";
  onChange: (next: "all" | "skills.sh" | "builtin") => void;
  skillsShEnabled: boolean;
}) {
  const { t } = useI18n();
  const tabs: Array<{
    key: "all" | "skills.sh" | "builtin";
    label: string;
    disabled?: boolean;
    hint?: string;
  }> = [
    { key: "all", label: t("specs.marketplace.source.all") },
    {
      key: "skills.sh",
      label: t("specs.marketplace.source.skillsSh"),
      disabled: !skillsShEnabled,
      hint: skillsShEnabled
        ? undefined
        : t("specs.marketplace.source.skillsShDisabled"),
    },
    { key: "builtin", label: t("specs.marketplace.source.builtin") },
  ];
  return (
    <div className="flex items-center gap-0.5 text-[11px] mono uppercase tracking-wider">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => !tab.disabled && onChange(tab.key)}
          disabled={tab.disabled}
          title={tab.hint}
          className={cn(
            "px-2 h-5 rounded transition-colors",
            tab.disabled
              ? "text-muted-foreground/40 cursor-not-allowed"
              : value === tab.key
                ? "bg-foreground/[0.08] text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SkillCard({
  entry,
  onInstall,
}: {
  entry: SkillMarketplaceEntry;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="size-8 rounded shrink-0 inline-flex items-center justify-center bg-sky-500/10 text-sky-700 dark:text-sky-300">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-sm">{entry.name}</span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                entry.publisher === "Anthropic"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : entry.publisher === "loom"
                    ? "bg-violet-500/10 text-violet-700 dark:text-violet-400"
                    : "bg-zinc-500/10 text-muted-foreground",
              )}
            >
              {entry.publisher}
            </span>
            {entry.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] mono text-muted-foreground/70"
              >
                #{tag}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground/90 leading-snug">
            {entry.description}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground/60 mono">
            {entry.content.length} chars
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button size="sm" onClick={onInstall} className="h-7 text-xs">
            {t("specs.marketplace.install")}
          </Button>
          {entry.source ? (
            <a
              href={entry.source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
            >
              {t("specs.marketplace.source")}
              <ExternalLink className="size-2.5" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
