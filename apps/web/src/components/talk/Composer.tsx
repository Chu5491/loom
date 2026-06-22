// Composer — @ 하나로 에이전트(라우팅)·스킬(첨부)·파일(경로 삽입) 검색.
// TalkPage 에서 분리. TargetSelector 는 Composer 전용이라 이 파일 내부에 둔다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Check, ChevronDown, Crown, FileText, Image as ImageIcon, Paperclip, Sparkles, X } from "lucide-react";
import type { AgentSpec, SkillSpec } from "@loom/core";
import { api } from "../../api/client.js";
import { useI18n } from "../../context/I18nContext.js";
import { useAlert } from "../../context/DialogContext.js";
import { cn } from "../../lib/utils.js";
import { Avatar } from "./atoms.js";

// ── 대상 선택 — 컴포저 인라인 단일 드롭다운(팀 패널과 중복 제거). ──────────────────
// "보내는 곳 = @에이전트" 한 곳에서만 고른다. 팀 패널은 현황 보드(클릭=바로가기).
function TargetSelector({ agents, active, onActive }: { agents: AgentSpec[]; active: string; onActive: (name: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const isAuto = active === "auto";
  const cur = agents.find((a) => a.name === active) ?? agents[0];
  // 마스터 = 채팅의 기본·유일 인입점. 나머지는 팀원(직접 지명 가능).
  const master = agents.find((a) => a.master);
  const team = agents.filter((a) => !a.master);
  const curIsMaster = !!cur?.master;

  const Row = (a: AgentSpec) => (
    <button
      key={a.name}
      type="button"
      onClick={() => { onActive(a.name); setOpen(false); }}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
        a.name === active ? "bg-primary/10" : "hover:bg-muted/60",
      )}
    >
      <Avatar agent={a} size={22} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{a.label || a.name}</span>
          {a.master ? <Crown className="size-3 shrink-0 text-amber-500" /> : null}
        </span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.model || a.adapter}</span>
      </span>
      {a.name === active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("talk.target.change")}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-0.5 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/15"
      >
        {isAuto ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-primary"><Sparkles className="size-3" /></span>
        ) : cur ? <Avatar agent={cur} size={20} /> : null}
        {/* 현재 대상이 마스터면 '마스터' 배지 — "대화는 마스터에게 간다"가 한눈에. */}
        {curIsMaster ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            <Crown className="size-2.5" />{t("talk.target.master")}
          </span>
        ) : null}
        <span className="max-w-28 truncate">{isAuto ? t("talk.target.auto") : cur?.label || cur?.name || "—"}</span>
        <ChevronDown className={cn("size-3.5 text-primary transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
          {/* 마스터 — 요청을 받아 직접 답하거나 팀원에게 위임하는 인입점. */}
          {master ? (
            <>
              <p className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                <Crown className="size-3" />{t("talk.target.master")}
              </p>
              {Row(master)}
            </>
          ) : null}
          {/* 팀원 — 특정 전문가에게 직접 지명. */}
          {team.length > 0 ? (
            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("talk.target.team")}</p>
          ) : null}
          {team.map(Row)}
          {/* @auto — 서버가 작업 텍스트로 적임자 자동 선택. */}
          <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("talk.target.other")}</p>
          <button
            type="button"
            onClick={() => { onActive("auto"); setOpen(false); }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              isAuto ? "bg-primary/10" : "hover:bg-muted/60",
            )}
          >
            <span className="flex size-[22px] items-center justify-center rounded-full bg-primary/20 text-primary"><Sparkles className="size-3.5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{t("talk.target.auto")}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{t("talk.target.autoHint")}</span>
            </span>
            {isAuto ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Composer — @ 하나로 에이전트(라우팅)·스킬(첨부)·파일(경로 삽입) 검색 ─────────
type MenuItem =
  | { kind: "agent"; agent: AgentSpec }
  | { kind: "skill"; skill: SkillSpec }
  | { kind: "file"; path: string };

export function Composer({
  agents,
  skills,
  projectId,
  active,
  onActive,
  onSend,
}: {
  agents: AgentSpec[];
  skills: SkillSpec[];
  projectId: string | null;
  active: string;
  onActive: (name: string) => void;
  onSend: (text: string, skills: string[], files: string[]) => void;
}) {
  const { t } = useI18n();
  const alert = useAlert();
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false); // Esc — 토큰은 두고 메뉴만 닫기
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 드롭/붙여넣기 파일 업로드 → 첨부 칩. 실패한 파일은 조용히 건너뛰지 않고 알림.
  async function addFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length) return;
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const { path } = await api.uploadAttachment(f);
        setAttachedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
      } catch (e) {
        void alert(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  // 커서 앞 텍스트의 끝이 "@partial" 이면 멘션 메뉴를 띄운다. 파일은 / . 도 허용.
  const token = useMemo(() => {
    const m = text.match(/(?:^|\s)@([a-zA-Z0-9_\-./]*)$/);
    return m ? m[1]! : null;
  }, [text]);
  const q = (token ?? "").toLowerCase();

  // 토큰이 바뀌면(계속 타이핑) 선택을 처음으로, 닫았던 메뉴는 다시 연다.
  useEffect(() => {
    setSelIdx(0);
    setDismissed(false);
  }, [token]);

  // 파일 검색 — 프로젝트가 선택돼 있고 멘션 중일 때만 서버 질의.
  const files = useQuery({
    queryKey: ["files", projectId, q],
    queryFn: () => api.searchProjectFiles(projectId!, q),
    enabled: !!projectId && token !== null,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  const menu = useMemo<MenuItem[]>(() => {
    if (token === null) return [];
    const agentHits = agents
      .filter((a) => a.name.toLowerCase().startsWith(q))
      .map((a): MenuItem => ({ kind: "agent", agent: a }));
    const skillHits = skills
      .filter((s) => !attached.includes(s.name) && s.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((s): MenuItem => ({ kind: "skill", skill: s }));
    const fileHits = (files.data?.files ?? [])
      .slice(0, 8)
      .map((p): MenuItem => ({ kind: "file", path: p }));
    return [...agentHits, ...skillHits, ...fileHits];
  }, [token, q, agents, skills, attached, files.data]);

  // 멘션 토큰을 replacement 로 치환(없애려면 ""). 끝에서만 동작 — token 검출과 동일 위치.
  function consumeToken(replacement: string) {
    setText((prev) => prev.replace(/@[a-zA-Z0-9_\-./]*$/, replacement));
    taRef.current?.focus();
  }

  function pick(item: MenuItem) {
    if (item.kind === "agent") {
      onActive(item.agent.name);
      consumeToken("");
    } else if (item.kind === "skill") {
      setAttached((prev) => [...prev, item.skill.name]);
      consumeToken("");
    } else {
      // 파일도 텍스트가 아니라 "선택된" 첨부 칩으로 — 전송 시 명시적으로 실린다.
      setAttachedFiles((prev) => (prev.includes(item.path) ? prev : [...prev, item.path]));
      consumeToken("");
    }
  }

  function submit() {
    if (!text.trim()) return;
    onSend(text, attached, attachedFiles);
    setText("");
    setAttached([]);
    setAttachedFiles([]);
  }

  const menuOpen = menu.length > 0 && !dismissed;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME(한글/일본어/중국어) 조합 중 Enter 는 글자 확정용 — 전송하면 안 됨.
    // 안 막으면 조합 완료 Enter + 실제 Enter 가 둘 다 발화해 마지막 글자가 또 전송됨.
    if (e.nativeEvent.isComposing) return;
    if (menuOpen) {
      // 키보드 네비 — ↑↓ 로 고르고 Enter/Tab 으로 확정, Esc 로 닫기(토큰 유지).
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => (i + 1) % menu.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => (i - 1 + menu.length) % menu.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        pick(menu[Math.min(selIdx, menu.length - 1)]!);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // 메뉴를 종류별 섹션으로.
  const sections: { key: string; label: string; items: MenuItem[] }[] = [
    { key: "agents", label: t("talk.menu.agents"), items: menu.filter((m) => m.kind === "agent") },
    { key: "skills", label: t("talk.menu.skills"), items: menu.filter((m) => m.kind === "skill") },
    { key: "files", label: t("talk.menu.files"), items: menu.filter((m) => m.kind === "file") },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="relative pb-5">
      {/* 멘션 메뉴 — 에이전트/스킬/파일 섹션. ↑↓ 키보드 선택, Esc 닫기 */}
      {menuOpen ? (
        <div className="absolute bottom-full left-0 z-10 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          <div className="sticky top-0 flex items-center justify-between border-b border-border/60 bg-card/95 px-3 py-1 backdrop-blur">
            <span className="text-[10px] text-muted-foreground">{t("talk.menu.hint")}</span>
            <button type="button" aria-label="close mention menu" onClick={() => setDismissed(true)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </div>
          {sections.map((sec) => (
            <div key={sec.key}>
              <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{sec.label}</div>
              {sec.items.map((item, i) => {
                const flat = menu.indexOf(item);
                const sel = flat === selIdx;
                return (
                <button
                  key={i}
                  type="button"
                  ref={(el) => { if (sel && el) el.scrollIntoView({ block: "nearest" }); }}
                  onClick={() => pick(item)}
                  onMouseEnter={() => setSelIdx(flat)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    sel ? "bg-primary/15" : "hover:bg-muted/60",
                  )}
                >
                  {item.kind === "agent" ? (
                    <>
                      <Avatar agent={item.agent} size={22} />
                      <span className="font-medium">{item.agent.label || item.agent.name}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{item.agent.adapter}</span>
                    </>
                  ) : item.kind === "skill" ? (
                    <>
                      <Sparkles className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.skill.name}</span>
                        {item.skill.description ? <span className="block truncate text-[11px] text-muted-foreground">{item.skill.description}</span> : null}
                      </span>
                    </>
                  ) : (
                    <>
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-xs">{item.path}</span>
                    </>
                  )}
                </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* 입력 — 파일/이미지를 끌어다 놓거나(드롭) 붙여넣으면 첨부된다 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative flex flex-col rounded-2xl border bg-card p-2 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
          dragOver ? "border-primary border-dashed bg-primary/5" : "border-border",
        )}
      >
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-[1px]">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Paperclip className="size-4" />
              {t("talk.dropHint")}
            </span>
          </div>
        ) : null}

        {/* 상단 줄 — 대상 선택(단일, 컴포저 인라인) + 첨부 스킬·파일 칩 */}
        <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5">
          <TargetSelector agents={agents} active={active} onActive={onActive} />
          {attached.length > 0 || attachedFiles.length > 0 ? (
            <span className="mx-0.5 h-4 w-px bg-border" />
          ) : null}
          {attached.length > 0 || attachedFiles.length > 0 ? (
            <>
            {attached.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 text-xs font-medium text-primary">
                <Sparkles className="size-3" />
                {s}
                <button type="button" aria-label={`detach ${s}`} onClick={() => setAttached((prev) => prev.filter((x) => x !== s))} className="rounded-full p-0.5 hover:bg-primary/20">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {attachedFiles.map((f) => {
              const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f);
              const Icon = isImage ? ImageIcon : FileText;
              return (
                <span key={f} title={f} className="inline-flex max-w-56 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-foreground">
                  <Icon className="size-3 shrink-0 text-primary" />
                  <span className="truncate">{f.split("/").pop()}</span>
                  <button type="button" aria-label={`detach ${f}`} onClick={() => setAttachedFiles((prev) => prev.filter((x) => x !== f))} className="shrink-0 rounded-full p-0.5 hover:bg-primary/20">
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            </>
          ) : null}
        </div>

        <div className="flex items-end gap-2">
        {/* 파일 선택 폴백 */}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          title={t("talk.attach")}
          onClick={() => fileRef.current?.click()}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {uploading > 0 ? <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Paperclip className="size-4" />}
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          rows={1}
          placeholder={t("talk.placeholder")}
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label={t("talk.send")}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-all",
            text.trim() ? "bg-gradient-accent shadow-[var(--shadow-glow-sm)]" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUp className="size-4" />
        </button>
        </div>
      </div>
    </div>
  );
}
