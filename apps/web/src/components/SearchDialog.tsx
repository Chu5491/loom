import { useEffect, useRef, useState } from "react";
import { useNavigate, useMatch } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, MessagesSquare, Search, Terminal } from "lucide-react";
import type { SearchResult } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";

export function SearchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const projectMatch = useMatch("/projects/:id/*");
  const projectId = projectMatch?.params?.id;

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const { data } = useQuery({
    queryKey: ["search", debouncedQuery, projectId],
    queryFn: () => api.search(debouncedQuery, { projectId }),
    enabled: open && debouncedQuery.length >= 2,
  });

  const results = data?.results ?? [];

  const go = (result: SearchResult) => {
    onClose();
    const pid = result.projectId;
    if (!pid) return;

    switch (result.kind) {
      case "thread":
        navigate(`/projects/${pid}?thread=${result.entityId}`);
        break;
      case "run":
        if (result.threadId) {
          navigate(`/projects/${pid}?thread=${result.threadId}`);
        } else {
          navigate(`/projects/${pid}`);
        }
        break;
      case "agent":
        navigate(`/projects/${pid}`);
        break;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      go(results[selected]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-foreground/20" />
      <div
        className="relative w-full max-w-lg bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={t("search.placeholder")}
            className="flex-1 h-10 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline text-[10px] text-muted-foreground/60 font-mono border border-border rounded px-1 py-0.5">
            esc
          </kbd>
        </div>

        {debouncedQuery.length >= 2 && results.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            {t("search.empty")}
          </div>
        ) : results.length > 0 ? (
          <ul className="max-h-[40vh] overflow-y-auto py-1">
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.entityId}`}>
                <button
                  type="button"
                  onClick={() => go(r)}
                  data-selected={i === selected || undefined}
                  className="w-full text-left px-3 py-2 flex items-start gap-2.5 text-sm transition-colors hover:bg-accent/50 data-[selected]:bg-accent"
                >
                  <KindIcon kind={r.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground">
                      <Highlighted text={r.title} />
                    </div>
                    {r.snippet && r.snippet !== r.title ? (
                      <div className="truncate text-xs text-muted-foreground mt-0.5">
                        <Highlighted text={r.snippet} />
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                    {r.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground/50">
          <span>↑↓ {t("search.hint.navigate")}</span>
          <span>↵ {t("search.hint.open")}</span>
          <span>esc {t("search.hint.close")}</span>
        </div>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: SearchResult["kind"] }) {
  switch (kind) {
    case "run":
      return (
        <Terminal className="size-4 text-muted-foreground shrink-0 mt-0.5" />
      );
    case "thread":
      return (
        <MessagesSquare className="size-4 text-sky-500 shrink-0 mt-0.5" />
      );
    case "agent":
      return (
        <Bot className="size-4 text-emerald-500 shrink-0 mt-0.5" />
      );
  }
}

function Highlighted({ text }: { text: string }) {
  const parts = text.split(/\x02|\x03/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-800/50 text-inherit rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
