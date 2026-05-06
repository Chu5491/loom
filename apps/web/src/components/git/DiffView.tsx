// Unified diff 텍스트를 +/- 컬러로 렌더. ChangedFiles 의 DiffView 와 동일 톤.

import { useI18n } from "../../context/I18nContext.js";

export function DiffView({ text }: { text: string }) {
  const { t } = useI18n();
  const hunkStart = text.indexOf("\n@@");
  const body = hunkStart >= 0 ? text.slice(hunkStart + 1) : text;
  if (!body.trim()) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground italic">
        {t("review.noTextDiff")}
      </p>
    );
  }
  const lines = body.split("\n");
  return (
    <pre className="overflow-x-auto h-full bg-background mono text-[11px] leading-relaxed">
      <code className="block">
        {lines.map((line, i) => {
          if (!line) return <span key={i} className="block">&nbsp;</span>;
          const ch = line[0];
          let className = "block px-3 py-px";
          if (ch === "+") {
            className += " bg-emerald-500/10 text-success";
          } else if (ch === "-") {
            className += " bg-rose-500/10 text-rose-700 dark:text-rose-300";
          } else if (ch === "@") {
            className += " bg-sky-500/10 text-sky-700 dark:text-sky-300";
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
  );
}
