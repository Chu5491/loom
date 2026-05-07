// MCP 마켓플레이스 다이얼로그 — 큐레이팅된 reference servers 목록.
//
// 클릭 → "Install" → /mcps/new?from=<id> 로 navigate. ServerEditor 가 query
// param 을 읽어 template 으로 prefill.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Plug, Search, X } from "lucide-react";
import { api, type McpMarketplaceEntry } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { InlineApiKey } from "../../components/marketplace/InlineApiKey.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

export function MarketplaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<
    "all" | "official" | "smithery" | "builtin"
  >("all");

  const list = useQuery({
    queryKey: ["mcp-marketplace", source],
    queryFn: () => api.listMcpMarketplace(source),
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

  const onInstall = (entry: McpMarketplaceEntry) => {
    onOpenChange(false);
    navigate(`/mcps/new?from=${encodeURIComponent(entry.id)}`);
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="mp-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            key="mp-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-[8vh] z-50 w-[min(720px,92vw)] -translate-x-1/2 rounded-lg border bg-popover shadow-2xl outline-none flex flex-col max-h-[80vh]"
          >
            <header className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
              <Plug className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {t("mcps.marketplace.title")}
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
                  placeholder={t("mcps.marketplace.searchPlaceholder")}
                  autoFocus
                  className="pl-7 h-8 text-sm"
                />
              </div>
              <SourceTabs
                value={source}
                onChange={setSource}
                smitheryEnabled={!!list.data?.sources.smitheryEnabled}
              />
              {/* smithery 탭에 들어왔는데 키가 없으면 같은 자리에 inline 입력
                  banner. 사용자가 굳이 Settings 까지 가지 않아도 됨. */}
              {source === "smithery" ? <InlineApiKey provider="smithery" /> : null}
            </div>

            <div className="flex-1 overflow-y-auto subtle-scrollbar p-3 space-y-2">
              {list.isLoading ? (
                <p className="px-2 py-4 text-xs text-muted-foreground italic">
                  {t("common.loading")}
                </p>
              ) : entries.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground/70 italic">
                  {t("mcps.marketplace.noMatch")}
                </p>
              ) : (
                entries.map((e) => (
                  <MarketplaceCard
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

function SourceTabs({
  value,
  onChange,
  smitheryEnabled,
}: {
  value: "all" | "official" | "smithery" | "builtin";
  onChange: (next: "all" | "official" | "smithery" | "builtin") => void;
  smitheryEnabled: boolean;
}) {
  const { t } = useI18n();
  // smithery 키 없을 때도 탭은 *클릭 가능* 하게 — 누르면 안에서 InlineApiKey 가
  // 키 입력 안내. 비활성화하고 tooltip 만 띄우면 사용자가 어디서 키 넣는지 모름.
  const tabs: Array<{
    key: "all" | "official" | "smithery" | "builtin";
    label: string;
    needsKey?: boolean;
  }> = [
    { key: "all", label: t("mcps.marketplace.source.all") },
    { key: "official", label: t("mcps.marketplace.source.official") },
    {
      key: "smithery",
      label: t("mcps.marketplace.source.smithery"),
      needsKey: !smitheryEnabled,
    },
    { key: "builtin", label: t("mcps.marketplace.source.builtin") },
  ];
  return (
    <div className="flex items-center gap-0.5 text-[11px] mono uppercase tracking-wider">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            "px-2 h-5 rounded transition-colors inline-flex items-center gap-1",
            value === tab.key
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {tab.label}
          {tab.needsKey ? (
            <span
              className="size-1 rounded-full bg-amber-500"
              aria-label="needs API key"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

function MarketplaceCard({
  entry,
  onInstall,
}: {
  entry: McpMarketplaceEntry;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-border bg-card p-3 hover:border-border transition-colors">
      <div className="flex items-start gap-3">
        <div className="size-8 rounded shrink-0 inline-flex items-center justify-center bg-violet-500/10 text-violet-700 dark:text-violet-300">
          <Plug className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-sm">{entry.name}</span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                entry.publisher === "Anthropic"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-zinc-500/10 text-muted-foreground",
              )}
            >
              {entry.publisher}
            </span>
            <span className="text-[10px] mono text-muted-foreground/70 shrink-0">
              {entry.template.kind}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/90 leading-snug">
            {entry.description}
          </p>
          {entry.placeholders && entry.placeholders.length > 0 ? (
            <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-400 mono">
              {t("mcps.marketplace.needsInput", {
                fields: entry.placeholders.map((p) => p.label).join(", "),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button size="sm" onClick={onInstall} className="h-7 text-xs">
            {t("mcps.marketplace.install")}
          </Button>
          <a
            href={entry.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          >
            {t("mcps.marketplace.source")}
            <ExternalLink className="size-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
