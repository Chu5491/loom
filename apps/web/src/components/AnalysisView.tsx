// 분석 뷰 — 분석 역할 에이전트의 구조화 리포트(JSON)를 시각 대시보드로.
// 글 대신 그림: 종합 점수 링, 카테고리 게이지, 언어 구성 바, 심각도 색상 카드.
// 마지막 리포트는 서버(data/analysis/)에 보존 — 탭을 떠나도 남는다.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, FileCode2, Files, FolderTree, Layers, Lightbulb, ScanSearch, Sigma, Sparkles,
} from "lucide-react";
import type { Project } from "@loom/core";
import { api, type AnalysisReport, type ProjectAnalysis } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

// 언어 구성 바 팔레트 — 테마와 무관하게 구분되는 비비드 시퀀스.
const LANG_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#f43f5e", "#64748b"];

const SEVERITY_TONE = {
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-border bg-muted/40 text-muted-foreground",
} as const;

const EFFORT_TONE = {
  small: "border-success/40 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  large: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

function scoreTone(score: number): string {
  return score >= 70 ? "text-success" : score >= 40 ? "text-warning" : "text-destructive";
}

export function AnalysisView({ project }: { project: Project }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const agentsQ = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const agents = agentsQ.data?.office.agents ?? [];
  const analystAgent = agents.find((a) => a.roles?.includes("analyst"));

  const [agent, setAgent] = useState("");
  const picked = agent || analystAgent?.name || agents[0]?.name || "";

  const stored = useQuery({
    queryKey: ["analysis", project.id],
    queryFn: () => api.getProjectAnalysis(project.id),
  });
  const [err, setErr] = useState<string | null>(null);
  const analyze = useMutation({
    mutationFn: () => api.analyzeProject(project.id, picked, lang),
    onSuccess: () => { setErr(null); void qc.invalidateQueries({ queryKey: ["analysis", project.id] }); },
    onError: (e) => setErr(e instanceof Error ? e.message.replace(/^\d+ [^:]+: /, "") : String(e)),
  });

  const analysis = stored.data?.analysis ?? null;
  const history = stored.data?.history ?? [];
  // 히스토리 보기 — 0=최신, 1부터는 과거 리포트. 새 분석이 오면 최신으로 복귀.
  const all = analysis ? [analysis, ...history] : [];
  const [viewIdx, setViewIdx] = useState(0);
  useEffect(() => setViewIdx(0), [analysis?.analyzedAt]);
  const viewing = all[Math.min(viewIdx, all.length - 1)] ?? null;
  const adapterOf = (name: string) => agents.find((a) => a.name === name)?.adapter;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto py-4">
      {/* 컨트롤 바 — 에이전트 선택 + 실행 */}
      <div className="flex flex-wrap items-center gap-2">
        <ScanSearch className="size-4 text-primary" />
        <h2 className="font-display text-sm font-semibold">{t("analysis.title")}</h2>
        {viewing ? (
          <span className="ml-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {adapterOf(viewing.agent) ? <AgentAvatar adapter={adapterOf(viewing.agent)!} size={16} className="rounded" /> : null}
            @{viewing.agent} · {new Date(viewing.analyzedAt).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            {viewIdx > 0 ? (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">{t("analysis.viewingOld")}</span>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={picked}
            onChange={(e) => setAgent(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                @{a.name} · {a.adapter}{a.roles?.includes("analyst") ? ` · ${t("analysis.analystBadge")}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!picked || analyze.isPending}
            onClick={() => analyze.mutate()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-gradient-accent px-3 text-xs font-medium text-white shadow-[var(--shadow-glow-sm)] transition-all hover:opacity-90 disabled:opacity-40 disabled:shadow-none"
          >
            <Sparkles className={cn("size-3.5", analyze.isPending && "animate-pulse")} />
            {analyze.isPending ? t("analysis.running") : analysis ? t("analysis.rerun") : t("analysis.run")}
          </button>
        </div>
      </div>
      {analyze.isPending ? <p className="mt-2 text-xs text-muted-foreground">{t("analysis.runningHint")}</p> : null}
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}

      {!analysis && !analyze.isPending ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
            <ScanSearch className="size-6" />
          </span>
          <h3 className="font-display text-base font-semibold">{t("analysis.emptyTitle")}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">{t("analysis.emptySub")}</p>
        </div>
      ) : null}

      {/* 히스토리 — 건강도 추이 + 과거 리포트 선택 */}
      {all.length > 1 ? <HistoryStrip all={all} viewIdx={viewIdx} onPick={setViewIdx} /> : null}

      {viewing ? <ReportBoard report={viewing.report} /> : null}
    </div>
  );
}

function overallOf(report: AnalysisReport): number | null {
  const h = report.health ?? {};
  const vals = (["tests", "docs", "structure", "maintainability"] as const)
    .map((k) => h[k])
    .filter((v): v is number => typeof v === "number");
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
}

// 추이 스파크라인(오래된→최신) + 리포트 칩. 클릭으로 과거 리포트 열람.
function HistoryStrip({ all, viewIdx, onPick }: { all: ProjectAnalysis[]; viewIdx: number; onPick: (i: number) => void }) {
  const { t, lang } = useI18n();
  const points = [...all].reverse().map((a) => overallOf(a.report)); // 오래된 → 최신
  const W = 160, H = 36;
  const xs = points.map((_, i) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 8) + 4));
  const poly = points
    .map((p, i) => (p === null ? null : `${xs[i]},${H - 4 - (p / 100) * (H - 8)}`))
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
      <span className="text-[11px] font-medium text-muted-foreground">{t("analysis.trend")}</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-40 shrink-0">
        <polyline points={poly} fill="none" strokeWidth="2" className="stroke-[var(--color-primary)]" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) =>
          p === null ? null : (
            <circle key={i} cx={xs[i]} cy={H - 4 - (p / 100) * (H - 8)} r="2.5"
              className={cn("fill-[var(--color-primary)]", all.length - 1 - i === viewIdx && "fill-[var(--color-foreground)]")} />
          ),
        )}
      </svg>
      <span className="flex flex-wrap gap-1">
        {all.map((a, i) => (
          <button
            key={a.analyzedAt}
            type="button"
            onClick={() => onPick(i)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
              i === viewIdx ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            {new Date(a.analyzedAt).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            {overallOf(a.report) !== null ? ` · ${overallOf(a.report)}` : ""}
          </button>
        ))}
      </span>
    </div>
  );
}

// ── 대시보드 ──────────────────────────────────────────────────────────────────
function ReportBoard({ report }: { report: AnalysisReport }) {
  const { t } = useI18n();
  const health = report.health ?? {};
  const healthEntries = (["tests", "docs", "structure", "maintainability"] as const)
    .filter((k) => typeof health[k] === "number")
    .map((k) => ({ key: k, score: health[k]! }));
  const overall = healthEntries.length
    ? Math.round(healthEntries.reduce((s, e) => s + e.score, 0) / healthEntries.length)
    : null;

  return (
    <div className="mt-4 space-y-4">
      {/* 히어로 — 종합 링 + 카테고리 게이지 + 빅넘버 */}
      {overall !== null || report.metrics.files || report.metrics.loc ? (
        <section className="relative flex flex-wrap items-center gap-6 overflow-hidden rounded-2xl border border-primary/20 bg-card p-5 shadow-[var(--shadow-glow-sm)]">
          <span className="absolute inset-x-0 top-0 h-1 bg-gradient-accent opacity-60" />
          {overall !== null ? <ScoreRing score={overall} label={t("analysis.overall")} /> : null}
          {healthEntries.length ? (
            <div className="min-w-44 flex-1 space-y-2.5">
              {healthEntries.map((e) => (
                <ScoreBar key={e.key} label={t(`analysis.health.${e.key}`)} score={e.score} />
              ))}
            </div>
          ) : null}
          <div className="flex gap-3">
            {typeof report.metrics.files === "number" ? (
              <BigNumber icon={<Files className="size-4" />} value={report.metrics.files.toLocaleString()} label={t("analysis.files")} />
            ) : null}
            {typeof report.metrics.loc === "number" ? (
              <BigNumber icon={<Sigma className="size-4" />} value={report.metrics.loc.toLocaleString()} label={t("analysis.loc")} />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 요약 + 스택 */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm leading-relaxed">{report.summary}</p>
        {report.stack.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.stack.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <Layers className="size-3" />
                {s}
              </span>
            ))}
          </div>
        ) : null}
        {/* 언어 구성 — 스택드 바 + 범례 */}
        {report.languages.length ? <LanguageBar languages={report.languages} /> : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {report.structure.length ? (
          <Card icon={<FolderTree className="size-4 text-primary" />} title={t("analysis.structure")}>
            {report.structure.map((s) => (
              <PathRow key={s.path} path={s.path} desc={s.desc} />
            ))}
          </Card>
        ) : null}

        {report.keyFiles.length ? (
          <Card icon={<FileCode2 className="size-4 text-primary" />} title={t("analysis.keyFiles")}>
            {report.keyFiles.map((s) => (
              <PathRow key={s.path} path={s.path} desc={s.desc} />
            ))}
          </Card>
        ) : null}

        {report.risks.length ? (
          <Card icon={<AlertTriangle className="size-4 text-warning" />} title={t("analysis.risks")} tone="warn">
            {report.risks.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={cn("mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase", SEVERITY_TONE[r.severity])}>
                  {t(`analysis.sev.${r.severity}`)}
                </span>
                <span className="text-sm leading-relaxed">{r.text}</span>
              </div>
            ))}
          </Card>
        ) : null}

        {report.suggestions.length ? (
          <Card icon={<Lightbulb className="size-4 text-primary" />} title={t("analysis.suggestions")}>
            {report.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={cn("mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", EFFORT_TONE[s.effort])}>
                  {t(`analysis.effort.${s.effort}`)}
                </span>
                <span className="text-sm leading-relaxed">{s.text}</span>
              </div>
            ))}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

// 종합 점수 — SVG 링 게이지. 진행 호는 시그니처 violet→cyan 그라데이션,
// 숫자는 점수 톤(성/주의/위험) — "브랜드"와 "판정"을 분리해 둘 다 읽힌다.
function ScoreRing({ score, label }: { score: number; label: string }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative flex size-28 shrink-0 items-center justify-center">
      <svg viewBox="0 0 100 100" className="size-28 -rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-accent-2, #06b6d4)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="8" className="stroke-muted/60" />
        <circle
          cx="50" cy="50" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * C} ${C}`}
          stroke="url(#ring-grad)" className="drop-shadow-[0_0_6px_var(--color-primary)] transition-all"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-display text-2xl font-bold tabular-nums", scoreTone(score))}>{score}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

// 카테고리 점수 — 가로 게이지 바.
function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60">
        <div
          className={cn("h-full rounded-full bg-current transition-all", scoreTone(score))}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn("w-7 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums", scoreTone(score))}>{score}</span>
    </div>
  );
}

function BigNumber({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex min-w-24 flex-col items-center justify-center rounded-xl border border-border/60 px-4 py-2.5">
      <span className="flex items-center gap-1.5 font-display text-xl font-bold tabular-nums">
        <span className="text-primary">{icon}</span>
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// 언어 구성 — 한 줄 스택드 바 + 색 범례.
function LanguageBar({ languages }: { languages: { name: string; percent: number }[] }) {
  const total = languages.reduce((s, l) => s + l.percent, 0) || 100;
  return (
    <div className="mt-4">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {languages.map((l, i) => (
          <div
            key={l.name}
            title={`${l.name} ${l.percent}%`}
            style={{ width: `${(l.percent / total) * 100}%`, background: LANG_COLORS[i % LANG_COLORS.length] }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {languages.map((l, i) => (
          <span key={l.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: LANG_COLORS[i % LANG_COLORS.length] }} />
            {l.name}
            <span className="font-mono tabular-nums">{l.percent}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Card({ icon, title, tone, children }: { icon: React.ReactNode; title: string; tone?: "warn"; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4", tone === "warn" ? "border-warning/30" : "border-border")}>
      <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function PathRow({ path, desc }: { path: string; desc: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <code className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">{path}</code>
      <span className="min-w-0 text-sm text-muted-foreground">{desc}</span>
    </div>
  );
}
