// hunk 별 stage / unstage 버튼이 달린 diff 뷰. WorkingTreePanel 의 우측 패널
// 전용 — CommitDetailPanel 처럼 "이미 끝난 커밋" 의 diff 에는 의미 없음 (그쪽은
// 그냥 DiffView 사용).

import { useMemo } from "react";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { parseDiff, buildPatch, type DiffHunk } from "./diff-hunks.js";

export function HunkDiffView({
  text,
  /** 현재 보여주는 diff 가 staged 영역인지 unstaged 영역인지.
   *  - staged 면: "Unstage hunk" 가 떠야 함 (cached + reverse). */
  staged,
  /** untracked 파일은 hunk 라는 게 의미 없음 — 통째로 stage 로 충분 + 부분
   *  staging 도 거의 쓸 일 없음. 그래서 버튼을 노출하지 않음. */
  disableHunkActions,
  onApplyHunk,
}: {
  text: string;
  staged: boolean;
  disableHunkActions?: boolean;
  /** 사용자가 hunk 의 stage/unstage 버튼을 눌렀을 때. patch 를 그대로 서버에. */
  onApplyHunk?: (input: {
    patch: string;
    cached: true;
    reverse: boolean;
  }) => void;
}) {
  const { t } = useI18n();
  const parsed = useMemo(() => parseDiff(text), [text]);

  if (parsed.hunks.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground italic">
        {t("review.noTextDiff")}
      </p>
    );
  }

  const handle = (hunk: DiffHunk) => {
    if (!onApplyHunk || disableHunkActions) return;
    const patch = buildPatch(parsed, [hunk]);
    onApplyHunk({ patch, cached: true, reverse: staged });
  };

  return (
    <div className="h-full overflow-x-auto bg-background mono text-[11px] leading-relaxed">
      {parsed.hunks.map((h, i) => (
        <HunkBlock
          key={i}
          hunk={h}
          staged={staged}
          disabled={!!disableHunkActions || !onApplyHunk}
          onAction={() => handle(h)}
          actionLabel={
            staged ? t("git.hunk.unstage") : t("git.hunk.stage")
          }
        />
      ))}
    </div>
  );
}

function HunkBlock({
  hunk,
  staged,
  disabled,
  onAction,
  actionLabel,
}: {
  hunk: DiffHunk;
  staged: boolean;
  disabled: boolean;
  onAction: () => void;
  actionLabel: string;
}) {
  // hunk 의 첫 줄이 헤더 (@@ ... @@), 나머지가 본문.
  const [headerLine, ...bodyLines] = hunk.lines;
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-1 bg-sky-500/10 text-sky-700 dark:text-sky-300 group">
        <span className="flex-1 truncate">{headerLine}</span>
        {!disabled ? (
          <button
            type="button"
            onClick={onAction}
            className={cn(
              "opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2 h-5 rounded text-[10px] uppercase tracking-wider transition-opacity",
              staged
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25",
            )}
            title={actionLabel}
          >
            {staged ? (
              <Minus className="size-3" />
            ) : (
              <Plus className="size-3" />
            )}
            {actionLabel}
          </button>
        ) : null}
      </div>
      <pre className="block">
        <code className="block">
          {bodyLines.map((line, i) => {
            if (!line) return <span key={i} className="block">&nbsp;</span>;
            const ch = line[0];
            let className = "block px-3 py-px";
            if (ch === "+") {
              className += " bg-emerald-500/10 text-success";
            } else if (ch === "-") {
              className += " bg-rose-500/10 text-rose-700 dark:text-rose-300";
            } else {
              className += " text-muted-foreground";
            }
            return (
              <span key={i} className={className}>
                {line || " "}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
