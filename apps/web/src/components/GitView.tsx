// Git 뷰 — 작업 변경(stage/unstage/commit) + Monaco diff + 에이전트 활동 피드.
// "어떤 에이전트가 어떤 파일을 어떻게 바꿨나"가 이 화면의 주인공.

import { Suspense, lazy, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Check, GitBranch, Minus, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { Project } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const CodeDiff = lazy(() => import("./Code.js").then((m) => ({ default: m.CodeDiff })));

const STATUS_TONE: Record<string, string> = {
  M: "text-warning border-warning/40 bg-warning/10",
  A: "text-success border-success/40 bg-success/10",
  D: "text-destructive border-destructive/40 bg-destructive/10",
  "?": "text-muted-foreground border-border bg-muted/40",
  R: "text-info border-info/40 bg-info/10",
};

export function GitView({ project }: { project: Project }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["git", project.id],
    queryFn: () => api.gitStatus(project.id),
    refetchInterval: 5000, // 에이전트가 일하는 동안 변경이 실시간으로 흘러들어온다
  });
  const versions = useQuery({
    queryKey: ["gitv", project.id, selected],
    queryFn: () => api.gitVersions(project.id, selected!),
    enabled: !!selected,
  });
  const activity = useQuery({
    queryKey: ["activity", project.id],
    queryFn: () => api.agentActivity(project.id),
    refetchInterval: 10_000,
  });
  const agentsQ = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const adapterOf = (name: string) => agentsQ.data?.office.agents.find((a) => a.name === name)?.adapter;

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["git", project.id] });
  const stage = useMutation({ mutationFn: (ps: string[]) => api.gitStage(project.id, ps), onSuccess: invalidate });
  const unstage = useMutation({ mutationFn: (ps: string[]) => api.gitUnstage(project.id, ps), onSuccess: invalidate });
  const commit = useMutation({
    mutationFn: () => api.gitCommit(project.id, message.trim()),
    onSuccess: () => { setMessage(""); setErr(null); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  // 커밋 메시지 AI 초안 — staged diff 를 선택한 에이전트에게.
  // 기본값: git 역할 에이전트 > 첫 에이전트 (드롭다운을 안 건드려도 동작).
  const [suggestAgent, setSuggestAgent] = useState("");
  const agents = agentsQ.data?.office.agents ?? [];
  const gitAgent = agents.find((a) => a.roles?.includes("git"));
  const draftAgent = suggestAgent || gitAgent?.name || agents[0]?.name || "";
  const suggest = useMutation({
    mutationFn: (agent: string) => api.gitSuggestCommit(project.id, agent),
    onSuccess: (r) => { setMessage(r.message); setErr(null); },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  // 원격 동기화 — push/pull/fetch. 결과·에러를 그대로 표면화.
  const remote = useMutation({
    mutationFn: (op: "push" | "pull" | "fetch") => api.gitRemote(project.id, op),
    onSuccess: (r) => { setErr(null); invalidate(); if (r.output && r.output !== "done") setErr(null); },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const s = status.data;
  if (s && !s.git) {
    return <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">{t("git.notRepo")}</div>;
  }
  const stagedFiles = s?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = s?.files.filter((f) => !f.staged) ?? [];

  return (
    <div className="flex h-full min-w-0 flex-1 gap-0 py-4">
      {/* 좌: 변경 + 커밋 + 활동 */}
      <div className="flex w-80 shrink-0 flex-col overflow-y-auto rounded-l-2xl border border-border bg-card/60 p-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5">
            <GitBranch className="size-3.5 text-primary" />
            <span className="font-mono text-xs font-medium">{s?.branch ?? "…"}</span>
          </span>
          <span className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px] tabular-nums",
            (s?.files.length ?? 0) > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground",
          )}>
            {t("git.changes", { n: String(s?.files.length ?? 0) })}
          </span>
        </div>

        {/* 원격 동기화 — push/pull/fetch. ahead/behind 가 있으면 카운트 배지. */}
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            variant="secondary" size="sm" className="h-7 flex-1"
            disabled={remote.isPending}
            title={t("git.push")} onClick={() => remote.mutate("push")}
          >
            <ArrowUpFromLine className="size-3.5" />{t("git.push")}
            {s?.remote && s.remote.ahead > 0 ? <span className="rounded-full bg-primary/20 px-1 text-[10px] tabular-nums text-primary">{s.remote.ahead}</span> : null}
          </Button>
          <Button
            variant="secondary" size="sm" className="h-7 flex-1"
            disabled={remote.isPending}
            title={t("git.pull")} onClick={() => remote.mutate("pull")}
          >
            <ArrowDownToLine className="size-3.5" />{t("git.pull")}
            {s?.remote && s.remote.behind > 0 ? <span className="rounded-full bg-warning/20 px-1 text-[10px] tabular-nums text-warning">{s.remote.behind}</span> : null}
          </Button>
          <Button
            variant="ghost" size="sm" className="h-7"
            disabled={remote.isPending}
            title={t("git.fetch")} aria-label={t("git.fetch")} onClick={() => remote.mutate("fetch")}
          >
            <RefreshCw className={cn("size-3.5", remote.isPending && "animate-spin")} />
          </Button>
        </div>

        <FileGroup
          title={t("git.staged")} files={stagedFiles} action="unstage" selected={selected} onSelect={setSelected}
          onAct={(p) => unstage.mutate([p])}
          onActAll={stagedFiles.length > 1 ? () => unstage.mutate(stagedFiles.map((f) => f.path)) : undefined}
          actAllLabel={t("git.unstageAll")}
        />
        <FileGroup
          title={t("git.unstaged")} files={unstagedFiles} action="stage" selected={selected} onSelect={setSelected}
          onAct={(p) => stage.mutate([p])}
          onActAll={unstagedFiles.length > 1 ? () => stage.mutate(unstagedFiles.map((f) => f.path)) : undefined}
          actAllLabel={t("git.stageAll")}
        />

        {/* 커밋 */}
        <div className="mt-3 border-t border-border/60 pt-3">
          {/* AI 초안 — 에이전트 선택 + ✨ 생성 */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <select
              value={draftAgent}
              onChange={(e) => setSuggestAgent(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {agents.length === 0 ? <option value="">{t("git.suggestAgent")}</option> : null}
              {agents.map((a) => (
                <option key={a.name} value={a.name}>@{a.name} · {a.adapter}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!draftAgent || stagedFiles.length === 0 || suggest.isPending}
              onClick={() => suggest.mutate(draftAgent)}
              title={
                !draftAgent ? t("git.suggestNeedAgent")
                : stagedFiles.length === 0 ? t("git.suggestNeedStaged")
                : t("git.suggest")
              }
              className={cn(
                "flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium text-white transition-all",
                "bg-gradient-accent shadow-[var(--shadow-glow-sm)] hover:opacity-90 disabled:opacity-40 disabled:shadow-none",
              )}
            >
              <Sparkles className={cn("size-3", suggest.isPending && "animate-pulse")} />
              {suggest.isPending ? t("git.suggesting") : t("git.suggest")}
            </button>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("git.commitPlaceholder")}
            className="min-h-16 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {err ? <p className="mt-1 text-[11px] text-destructive">{err}</p> : null}
          <Button
            size="sm"
            className="mt-1.5 w-full"
            disabled={!message.trim() || stagedFiles.length === 0 || commit.isPending}
            onClick={() => commit.mutate()}
          >
            <Check className="size-3.5" />
            {commit.isPending ? "…" : t("git.commit", { n: String(stagedFiles.length) })}
          </Button>
        </div>

        {/* 에이전트 활동 — 누가 어떤 파일을 바꿨나 */}
        {(activity.data?.activity.length ?? 0) > 0 ? (
          <div className="mt-4 border-t border-border/60 pt-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3" />
              {t("git.agentActivity")}
            </h3>
            <div className="space-y-2">
              {activity.data!.activity.slice(0, 20).map((a) => {
                const adapter = adapterOf(a.agent);
                return (
                  <div key={a.runId} className="rounded-lg border border-border/60 p-2">
                    <div className="flex items-center gap-1.5">
                      {adapter ? <AgentAvatar adapter={adapter} size={18} className="rounded-md" /> : null}
                      <span className="text-xs font-medium">{a.agent}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {new Date(a.startedAt).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.files.map((f) => (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => setSelected(relativize(f.path, project.path))}
                          className={cn(
                            "rounded border px-1 py-0.5 font-mono text-[10px] transition-colors hover:opacity-80",
                            f.action === "edit" ? "border-warning/40 bg-warning/10 text-warning" : "border-success/40 bg-success/10 text-success",
                          )}
                        >
                          {f.path.split("/").pop()}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* 우: diff */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-r-2xl border border-l-0 border-border bg-card">
        {selected && versions.data ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
              <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">HEAD</span>
              <span className="text-muted-foreground">→</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{t("git.working")}</span>
              <span className="ml-1 truncate font-mono text-xs">{selected}</span>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">…</p>}>
                <CodeDiff path={selected} original={versions.data.head ?? ""} modified={versions.data.working ?? ""} />
              </Suspense>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("git.pick")}</div>
        )}
      </div>
    </div>
  );
}

// run 이벤트의 파일 경로는 절대경로일 수 있음 — 프로젝트 기준 상대로.
function relativize(p: string, root: string): string {
  const norm = root.endsWith("/") ? root : root + "/";
  if (p.startsWith(norm)) return p.slice(norm.length);
  // macOS /tmp ↔ /private/tmp 같은 별칭도 흡수
  const privNorm = "/private" + norm;
  if (p.startsWith(privNorm)) return p.slice(privNorm.length);
  return p;
}

function FileGroup({
  title,
  files,
  action,
  selected,
  onSelect,
  onAct,
  onActAll,
  actAllLabel,
}: {
  title: string;
  files: { status: string; path: string }[];
  action: "stage" | "unstage";
  selected: string | null;
  onSelect: (p: string) => void;
  onAct: (p: string) => void;
  onActAll?: () => void;
  actAllLabel?: string;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="mb-1 flex items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title} · {files.length}
        {onActAll ? (
          <button
            type="button"
            onClick={onActAll}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            {actAllLabel}
          </button>
        ) : null}
      </h3>
      <div className="space-y-0.5">
        {files.map((f) => (
          <div
            key={f.path}
            className={cn(
              "group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors",
              selected === f.path ? "bg-primary/15" : "hover:bg-muted/60",
            )}
          >
            <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border font-mono text-[9px] font-bold", STATUS_TONE[f.status] ?? STATUS_TONE["?"])}>
              {f.status}
            </span>
            <button type="button" onClick={() => onSelect(f.path)} className="min-w-0 flex-1 truncate text-left font-mono text-[11px]">
              {f.path}
            </button>
            <button
              type="button"
              title={action}
              onClick={() => onAct(f.path)}
              className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition hover:text-primary group-hover:opacity-100"
            >
              {action === "stage" ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
