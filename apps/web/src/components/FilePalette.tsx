import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search } from "lucide-react";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const MAX_RESULTS = 30;

/**
 * VS Code style "Quick Open" file palette. Toggled with ⌘P / Ctrl+P,
 * lets the user fuzzy-search for any file in the project tree and open
 * it in the workspace with a single keystroke. Esc / blur dismisses.
 *
 * Match scoring is simple: every query character must appear in the
 * path in order (substring fuzzy). Score rewards consecutive matches,
 * matches in the basename, and shorter paths — which mirrors how
 * VS Code's filter feels in practice. Sufficient for the tens of
 * thousands of files cap on the server endpoint.
 */
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
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Files are fetched once on first open and cached for 30s — refresh
  // on every keystroke would hammer the server for nothing.
  const filesQuery = useQuery({
    queryKey: ["projectFilesFlat", projectId],
    queryFn: () => api.getProjectFilesFlat(projectId),
    enabled: open,
    staleTime: 30_000,
  });
  const all = filesQuery.data?.paths ?? [];

  const matches = useMemo(() => {
    if (!query.trim()) {
      // Empty query → show first N files alphabetically. Gives the
      // palette a useful resting state instead of "type to begin".
      return all.slice(0, MAX_RESULTS);
    }
    const q = query.toLowerCase();
    const scored: Array<{ path: string; score: number }> = [];
    for (const path of all) {
      const score = fuzzyScore(path.toLowerCase(), q);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return scored.slice(0, MAX_RESULTS).map((s) => s.path);
  }, [all, query]);

  // Reset highlight on query change so we always start at the top match.
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Focus input on open, dismiss on Escape, navigate with arrows.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
    >
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[min(640px,90vw)] rounded-lg border bg-popover shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((i) => Math.min(matches.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((i) => Math.max(0, i - 1));
              } else if (
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
                const pick = matches[highlight];
                if (pick) {
                  onPickFile(pick);
                  onClose();
                }
              }
            }}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent border-0 px-0 py-1 text-sm focus:outline-none focus:ring-0"
          />
          <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
            {filesQuery.isLoading
              ? "…"
              : t("palette.indexed", { n: all.length })}
          </span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {filesQuery.isLoading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground italic">
              {t("common.loading")}
            </p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground italic">
              {t("palette.empty")}
            </p>
          ) : (
            <ul>
              {matches.map((path, i) => (
                <li key={path}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Avoid blur-then-click race; act on mousedown so
                      // the input doesn't lose focus (which would
                      // dismiss the palette before our click runs).
                      e.preventDefault();
                      onPickFile(path);
                      onClose();
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                      i === highlight ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">
                      {basename(path)}
                    </span>
                    <span className="text-xs text-muted-foreground/70 mono truncate ml-2">
                      {dirOf(path)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Subsequence-based fuzzy score. Every char of `query` must appear in
 * `text` in order; consecutive matches and matches in the basename
 * weigh more. Returns 0 for non-matches, higher = better.
 */
function fuzzyScore(text: string, query: string): number {
  let ti = 0;
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  const baseStart = text.lastIndexOf("/") + 1;
  while (ti < text.length && qi < query.length) {
    if (text[ti] === query[qi]) {
      score += 1;
      if (ti >= baseStart) score += 1; // basename match
      consecutive += 1;
      score += consecutive; // streak bonus
      qi++;
    } else {
      consecutive = 0;
    }
    ti++;
  }
  if (qi < query.length) return 0; // not all chars matched
  return score;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}
