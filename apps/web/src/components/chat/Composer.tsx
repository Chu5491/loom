// 메시지 작성 영역 — 텍스트박스 + 슬래시 메뉴 + 타깃 에이전트 선택 + 컨텍스트 토글 + 전송.

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Paperclip, Send } from "lucide-react";
import type { AdapterManifest, Agent } from "@loom/core";
import { api } from "../../api/client.js";
import { Button } from "../ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands.js";

export function Composer({
  agents,
  manifests,
  agentIds,
  onAgentIdsChange,
  threadId,
  threadHasContext,
  onThreadCreated,
  initialDraft,
  draftKey,
  onSent,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  /** 선택된 타깃. 단일 원소 배열 — 멀티 브로드캐스트 제거됨(한 방, 한 명). */
  agentIds: string[];
  onAgentIdsChange: (ids: string[]) => void;
  /** null = 다음 전송에서 새 스레드 생성, 부모는 onThreadCreated로 id 받음. */
  threadId?: string | null;
  threadHasContext?: boolean;
  onThreadCreated?: (id: string) => void;
  initialDraft?: string;
  draftKey?: number;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = useState(initialDraft ?? "");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 슬래시 커맨드 팔레트 — `/`로 시작하고 공백 전까지만 활성.
  const slashMatch = /^\/([a-z]*)$/i.exec(text);
  const slashOpen = !!slashMatch;
  const slashQuery = slashMatch?.[1] ?? "";
  const slashMatches = slashOpen
    ? SLASH_COMMANDS.filter((c) =>
        c.cmd.slice(1).toLowerCase().startsWith(slashQuery.toLowerCase()),
      )
    : [];
  const [slashIndex, setSlashIndex] = useState(0);
  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  const commitSlash = (cmd: SlashCommand) => {
    const next = `${cmd.cmd} `;
    setText(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.length, next.length);
      }
    });
  };

  useEffect(() => {
    if (initialDraft !== undefined) {
      setText(initialDraft);
      const el = textareaRef.current;
      if (el) {
        el.focus();
        requestAnimationFrame(() =>
          el.setSelectionRange(el.value.length, el.value.length),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // textarea 자동 grow (최대 8줄).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 8 * 20;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, [text]);

  // IME 더블파이어 + isSending 미flush race 방지용 동기 latch.
  const sendingRef = useRef(false);

  // "컨텍스트 첨부" 토글 — 스레드별 localStorage 저장.
  const attachKey = threadId ? `loom:thread:${threadId}:attachContext` : null;
  const [attachContext, setAttachContext] = useState<boolean>(() => {
    if (!attachKey || typeof window === "undefined") {
      return !!threadHasContext;
    }
    const stored = window.localStorage.getItem(attachKey);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return !!threadHasContext;
  });
  useEffect(() => {
    if (!attachKey) return;
    const stored = window.localStorage.getItem(attachKey);
    if (stored === "1") setAttachContext(true);
    else if (stored === "0") setAttachContext(false);
    else setAttachContext(!!threadHasContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachKey]);
  useEffect(() => {
    if (!attachKey) return;
    try {
      window.localStorage.setItem(attachKey, attachContext ? "1" : "0");
    } catch {
      // private mode/quota — 무시
    }
  }, [attachKey, attachContext]);

  const setTarget = (id: string) => onAgentIdsChange([id]);
  const target = agents.find((a) => a.id === agentIds[0]) ?? null;
  const placeholder = target
    ? t("chat.composer.placeholder", { agent: target.name })
    : t("chat.composer.placeholderNoAgent");

  const send = async () => {
    if (sendingRef.current || !target || !text.trim() || isSending) return;
    sendingRef.current = true;
    setIsSending(true);
    try {
      const r = await api.createRun({
        agentId: target.id,
        prompt: text,
        threadId: threadId ?? null,
        includeContext: attachContext && threadHasContext,
      });
      const newId = r.run.threadId;
      if (newId && newId !== threadId) onThreadCreated?.(newId);
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      setText("");
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const canSend = !!target && text.trim().length > 0 && !isSending;

  return (
    // 좌우 정렬:
    //   - 메시지 텍스트 left = MessageRow.px(8/16) + avatar(28/32) + gap(8/12) ≈ 44 / 60
    //   - composer 자체는 아바타가 없으므로, 빈 슬롯만큼 pl을 추가해 textarea
    //     글자가 위쪽 메시지 텍스트와 같은 세로축에 떨어지도록 정렬.
    //   - 우측은 MessageRow.px와 동일하게 — bordered box 우측 끝이 메시지 행
    //     우측 끝과 일치.
    <div className="mx-auto w-full max-w-3xl pl-9 pr-2 py-1.5 @[480px]:pl-12 @[480px]:pr-4 @[480px]:py-2 bg-card shrink-0">
      <div className="relative rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring transition-shadow">
        <AnimatePresence>
          {slashOpen && slashMatches.length > 0 ? (
            <motion.div
              key="slash-menu"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              <SlashMenu
                matches={slashMatches}
                highlight={slashIndex}
                onPick={commitSlash}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (slashOpen && slashMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex(
                  (i) => (i - 1 + slashMatches.length) % slashMatches.length,
                );
                return;
              }
              if (
                (e.key === "Enter" || e.key === "Tab") &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
                commitSlash(slashMatches[slashIndex]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setText("");
                return;
              }
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          disabled={!target}
          className="w-full resize-none bg-transparent px-3 py-1.5 text-sm leading-snug placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          style={{ minHeight: "32px" }}
        />
        <div className="flex items-center justify-between gap-1 border-t border-border/60 px-1.5 py-0.5">
          <Select
            value={target?.id ?? ""}
            onValueChange={(id) => {
              if (id) setTarget(id);
            }}
          >
            <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent hover:bg-muted px-1.5 shadow-none focus:ring-0">
              <SelectValue>
                {target ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AgentAvatar
                      agent={target}
                      manifest={manifests.find(
                        (m) => m.kind === target.adapterKind,
                      )}
                      size="sm"
                    />
                    <span
                      className={cn(
                        "text-xs font-medium",
                        classesFor(agentColorOf(target)).text,
                      )}
                    >
                      @{target.name}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("chat.composer.placeholderNoAgent")}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {agents.map((a) => {
                const m = manifests.find((mm) => mm.kind === a.adapterKind);
                const c = classesFor(agentColorOf(a));
                return (
                  <SelectItem key={a.id} value={a.id} className="pl-8">
                    <span className="flex items-center gap-2">
                      <AgentAvatar agent={a} manifest={m} size="sm" />
                      <span className={cn("text-sm font-medium", c.text)}>
                        @{a.name}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 shrink-0">
            {threadHasContext ? (
              <button
                type="button"
                onClick={() => setAttachContext((v) => !v)}
                title={
                  attachContext
                    ? t("chat.composer.contextOn")
                    : t("chat.composer.contextOff")
                }
                aria-pressed={attachContext}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 h-6 rounded text-[11px] transition-colors",
                  attachContext
                    ? "text-sky-700 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Paperclip className="size-3" />
                <span className="hidden @[420px]:inline">
                  {t("chat.composer.context")}
                </span>
              </button>
            ) : null}
            {/* Enter 힌트는 dock가 충분히 넓을 때만. 좁으면 잘림이 더 시끄러움. */}
            <span className="text-[10px] text-muted-foreground/70 hidden @[520px]:inline">
              {t("chat.composer.hint")}
            </span>
            <Button
              size="icon"
              className="size-7"
              disabled={!canSend}
              onClick={send}
              aria-label={t("chat.composer.send")}
            >
              <Send />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** textarea 위에 떠 있는 슬래시 커맨드 메뉴. */
function SlashMenu({
  matches,
  highlight,
  onPick,
}: {
  matches: SlashCommand[];
  highlight: number;
  onPick: (cmd: SlashCommand) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border bg-popover shadow-lg overflow-hidden z-30">
      <ul className="max-h-56 overflow-y-auto py-1">
        {matches.map((c, i) => (
          <li key={c.cmd}>
            <button
              type="button"
              onMouseDown={(e) => {
                // textarea blur 방지 — onMouseDown이 onClick보다 먼저 발생, blur는 메뉴 닫음.
                e.preventDefault();
              }}
              onClick={() => onPick(c)}
              className={cn(
                "flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
                i === highlight ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span className="mono text-sm font-semibold text-foreground shrink-0">
                {c.cmd}
              </span>
              <span className="text-sm text-foreground/80">
                {t(c.i18nLabel)}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/70 truncate">
                {t(c.i18nHint)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
