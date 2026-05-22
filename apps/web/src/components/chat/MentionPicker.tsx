// `@` 와 `/` 픽커 — 텍스트박스 위에 떠 있는 자동완성 메뉴.
//
//   `@` → 에이전트(상단) + 현재 프로젝트의 파일(하단)
//         에이전트 선택 → 타깃 변경, 파일 선택 → "@<path>" 토큰 삽입
//   `/` → 현재 에이전트의 스킬 + MCP   (token: "[skill: name]" / "[mcp: name]")

import { Bot, Files as FilesIcon, FileText, Plug } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";

export interface PickItem {
  kind: "agent" | "file" | "skill" | "mcp";
  /** 텍스트박스에 박힐 토큰 (trailing space 는 commit 시 별도 추가).
   *  agent kind 일 때는 에이전트 id — Composer 가 타깃 변경에 사용. */
  token: string;
  /** 메뉴에 보이는 1차 라벨. */
  label: string;
  /** 2차 메타 (file dir, mcp kind, adapter kind 등). */
  meta?: string;
}

export function MentionPicker({
  items,
  highlight,
  onPick,
  emptyHint,
}: {
  items: PickItem[];
  highlight: number;
  onPick: (item: PickItem) => void;
  emptyHint: string;
}) {
  // section 라벨로 그룹핑 — kind 순서대로.
  const sections: { kind: PickItem["kind"]; items: PickItem[] }[] = [];
  for (const it of items) {
    const last = sections[sections.length - 1];
    if (last && last.kind === it.kind) last.items.push(it);
    else sections.push({ kind: it.kind, items: [it] });
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border bg-popover shadow-lg overflow-hidden z-30">
      <ul className="max-h-72 overflow-y-auto py-1">
        {items.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {emptyHint}
          </li>
        ) : null}
        {sections.map((sec, sIdx) => {
          const offset = items.indexOf(sec.items[0]!);
          return (
            <div key={`${sec.kind}-${sIdx}`}>
              <div className="px-3 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                {SECTION_LABEL[sec.kind]}
              </div>
              {sec.items.map((item, i) => {
                const idx = offset + i;
                return (
                  <li key={`${sec.kind}:${item.token}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // textarea blur 방지 — onMouseDown 이 onClick 보다 먼저, blur 하면 메뉴가 닫힘.
                        e.preventDefault();
                      }}
                      onClick={() => onPick(item)}
                      className={cn(
                        "flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
                        idx === highlight ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <KindIcon kind={item.kind} />
                      <span className="text-sm text-foreground truncate flex-1">
                        {item.kind === "file"
                          ? basename(item.label)
                          : item.label}
                      </span>
                      {item.meta ? (
                        <span className="text-[10px] mono text-muted-foreground/70 truncate max-w-[14rem]">
                          {item.meta}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </div>
          );
        })}
      </ul>
    </div>
  );
}

const SECTION_LABEL: Record<PickItem["kind"], string> = {
  agent: "Agents",
  file: "Files",
  skill: "Skills",
  mcp: "MCPs",
};

function KindIcon({ kind }: { kind: PickItem["kind"] }) {
  if (kind === "agent")
    return <Bot className="size-3 text-muted-foreground/70 shrink-0" />;
  if (kind === "file")
    return <FilesIcon className="size-3 text-muted-foreground/70 shrink-0" />;
  if (kind === "skill")
    return <FileText className="size-3 text-muted-foreground/70 shrink-0" />;
  return <Plug className="size-3 text-muted-foreground/70 shrink-0" />;
}

/** caret 위치 기준으로 트리거(`@` 또는 `/`)를 역추적. 트리거 앞 char 이
 *  whitespace 거나 텍스트 시작일 때만 active. */
export function detectTrigger(
  text: string,
  caret: number,
): { trigger: "@" | "/"; triggerPos: number; query: string } | null {
  // caret 직전부터 거꾸로 — whitespace 만나면 트리거 없음, `@`/`/` 만나면 검사.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") return null;
    if (ch === "@" || ch === "/") {
      // 트리거 앞은 시작이거나 whitespace.
      if (i === 0) {
        return { trigger: ch, triggerPos: i, query: text.slice(i + 1, caret) };
      }
      const prev = text[i - 1]!;
      if (prev === " " || prev === "\t" || prev === "\n") {
        return { trigger: ch, triggerPos: i, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    i--;
  }
  return null;
}

/** 트리거 + query 위치를 token + trailing space 로 교체. caret 은 토큰 뒤로. */
export function applyPick(
  text: string,
  trigger: { trigger: "@" | "/"; triggerPos: number; query: string },
  token: string,
): { text: string; caret: number } {
  const before = text.slice(0, trigger.triggerPos);
  const after = text.slice(trigger.triggerPos + 1 + trigger.query.length);
  // after 가 이미 space 로 시작하면 우리 space 를 안 끼워서 더블 스페이스 회피.
  const sep = after.startsWith(" ") || after.length === 0 ? "" : " ";
  const out = `${before}${token}${sep}${after}`;
  return { text: out, caret: before.length + token.length + sep.length };
}
