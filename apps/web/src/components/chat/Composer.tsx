// 메시지 작성 영역 — 텍스트박스 + @ 파일 / 스킬·MCP 자동완성 + 타깃 에이전트
// 선택 + 컨텍스트 토글 + 전송.
//
// 자동완성 규칙:
//   `@` → 현재 프로젝트의 파일들. token: `@<path>` (CLI 가 파일 ref 로 인식)
//   `/` → 현재 에이전트가 가진 skill / MCP. token: `[skill: name]` / `[mcp: name]`
//          — 본문은 매 run loadout 디렉터리에 펼쳐지므로 이름 언급만으로 충분.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Paperclip, Send, Sparkles } from "lucide-react";
import type { AdapterManifest, Agent } from "@loom/core";
import { useParams } from "react-router-dom";
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
import {
  MentionPicker,
  applyPick,
  detectTrigger,
  type PickItem,
} from "./MentionPicker.js";

const MAX_FILES_SHOWN = 30;

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
  const { id: projectId } = useParams<{ id: string }>();
  const [text, setText] = useState(initialDraft ?? "");
  const [caret, setCaret] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const target = agents.find((a) => a.id === agentIds[0]) ?? null;

  // 트리거 감지 — text + caret 의 함수.
  const trigger = useMemo(() => detectTrigger(text, caret), [text, caret]);

  // `@` 일 때만 fetch — 프로젝트 파일은 양이 클 수 있고 picker 가 안 떠있는데
  // 미리 끌어올 이유가 없음.
  const filesQuery = useQuery({
    queryKey: ["projectFilesFlat", projectId],
    queryFn: () => api.getProjectFilesFlat(projectId!),
    enabled: !!projectId && trigger?.trigger === "@",
    staleTime: 30_000,
  });

  // `/` 일 때만 fetch — 에이전트의 skillIds / mcpServerIds 를 spec / server 로
  // 풀어옴. listSpecs/listMcpServers 는 풀 카탈로그라 클라가 필터링.
  const specsQuery = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
    enabled: trigger?.trigger === "/",
    staleTime: 30_000,
  });
  const mcpQuery = useQuery({
    queryKey: ["mcpServers"],
    queryFn: () => api.listMcpServers(),
    enabled: trigger?.trigger === "/",
    staleTime: 30_000,
  });

  // 트리거에 따라 목록 구성.
  const items = useMemo<PickItem[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();

    if (trigger.trigger === "@") {
      const paths = filesQuery.data?.paths ?? [];
      const filtered = paths.filter((p) => p.toLowerCase().includes(q));
      return filtered.slice(0, MAX_FILES_SHOWN).map<PickItem>((p) => {
        const slash = p.lastIndexOf("/");
        const dir = slash >= 0 ? p.slice(0, slash) : "";
        return {
          kind: "file",
          token: `@${p}`,
          label: p,
          meta: dir || undefined,
        };
      });
    }

    // `/` — 현재 에이전트의 skill + MCP. 에이전트 없으면 빈 배열.
    if (!target) return [];
    const skillIds = new Set(target.skillIds);
    const mcpIds = new Set(target.mcpServerIds);
    const skills = (specsQuery.data?.specs ?? [])
      .filter((s) => skillIds.has(s.id))
      .filter((s) => s.name.toLowerCase().includes(q))
      .map<PickItem>((s) => ({
        kind: "skill",
        token: `[skill: ${s.name}]`,
        label: s.name,
      }));
    const mcps = (mcpQuery.data?.servers ?? [])
      .filter((m) => mcpIds.has(m.id))
      .filter((m) => m.name.toLowerCase().includes(q))
      .map<PickItem>((m) => ({
        kind: "mcp",
        token: `[mcp: ${m.name}]`,
        label: m.name,
        meta: m.kind,
      }));
    return [...skills, ...mcps];
  }, [trigger, filesQuery.data, specsQuery.data, mcpQuery.data, target]);

  const [pickerIndex, setPickerIndex] = useState(0);
  useEffect(() => {
    setPickerIndex(0);
  }, [trigger?.trigger, trigger?.query]);

  // 트리거가 살아있는 동안은 picker 가 떠있다고 판단 — items 가 비어 있어도
  // empty hint 를 보여주고 Enter 가 send 로 새지 않게 막음.
  const pickerOpen = !!trigger;

  const commitPick = (item: PickItem) => {
    if (!trigger) return;
    const next = applyPick(text, trigger, item.token);
    setText(next.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
        setCaret(next.caret);
      }
    });
  };

  useEffect(() => {
    if (initialDraft !== undefined) {
      setText(initialDraft);
      const el = textareaRef.current;
      if (el) {
        el.focus();
        requestAnimationFrame(() => {
          el.setSelectionRange(el.value.length, el.value.length);
          setCaret(el.value.length);
        });
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

  // "fresh session" 토글 — true면 다음 send에서 --resume 안 붙임. 한 번 켜면
  // 그 thread 내내 켜진 채로 유지. 사용자가 의식적으로 새 세션을 시작하고
  // 싶을 때(이전 컨텍스트가 다른 일이라 헷갈릴 때)의 명시적 탈출구.
  const [freshSession, setFreshSession] = useState(false);

  const setTarget = (id: string) => onAgentIdsChange([id]);
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
        freshSession,
      });
      const newId = r.run.threadId;
      if (newId && newId !== threadId) onThreadCreated?.(newId);
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      setText("");
      // 한 번 보내고 나면 "fresh"는 이미 효과 봤으니 자동으로 꺼짐 — 무심코
      // 다음 메시지에 또 fresh가 적용되어 컨텍스트가 끊기는 사고 방지.
      setFreshSession(false);
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
          {pickerOpen ? (
            <motion.div
              key="mention-picker"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              <MentionPicker
                items={items}
                highlight={Math.min(pickerIndex, Math.max(0, items.length - 1))}
                onPick={commitPick}
                emptyHint={
                  trigger?.trigger === "@"
                    ? t("chat.mention.fileEmpty")
                    : t("chat.mention.slashEmpty")
                }
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => {
            const el = e.currentTarget;
            setCaret(el.selectionStart ?? 0);
          }}
          onKeyDown={(e) => {
            if (pickerOpen) {
              if (items.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPickerIndex((i) => (i + 1) % items.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPickerIndex(
                    (i) => (i - 1 + items.length) % items.length,
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
                  const item = items[pickerIndex] ?? items[0];
                  if (item) commitPick(item);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                // 트리거 char + query 만 지움 — 본문은 보존.
                if (trigger) {
                  const before = text.slice(0, trigger.triggerPos);
                  const after = text.slice(
                    trigger.triggerPos + 1 + trigger.query.length,
                  );
                  setText(before + after);
                  requestAnimationFrame(() => {
                    const el = textareaRef.current;
                    if (el) {
                      el.focus();
                      el.setSelectionRange(before.length, before.length);
                      setCaret(before.length);
                    }
                  });
                }
                return;
              }
              // picker 가 떠있는 동안 Enter 는 send 로 안 새게 — 빈 항목이라도
              // 무심코 Enter 로 보내면 의도와 다르게 트리거 char 가 prompt 에 박힘.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
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
            {/* "fresh session" 토글 — 켜면 다음 send에 --resume 안 붙음. 이전
                대화가 다른 일이라 헷갈리는 경우의 명시적 탈출구. 한 번 보내면
                자동으로 꺼짐. */}
            <button
              type="button"
              onClick={() => setFreshSession((v) => !v)}
              title={
                freshSession
                  ? t("chat.composer.freshOn")
                  : t("chat.composer.freshOff")
              }
              aria-pressed={freshSession}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 h-6 rounded text-[11px] transition-colors",
                freshSession
                  ? "text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Sparkles className="size-3" />
              <span className="hidden @[420px]:inline">
                {t("chat.composer.fresh")}
              </span>
            </button>
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
