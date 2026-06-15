// 홈 = 회사 대시보드. 인원(에이전트)·양식(office)·연결(CLI)·사용량을 한눈에 보고,
// 진행 중인 프로젝트로 "들어간다"(depth 흐름). 프로젝트 추가는 폴더 피커로.

import {useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {
    ArrowRight,
    ArrowUp,
    Check,
    CircleDollarSign,
    FileText,
    FolderGit2,
    FolderOpen,
    House,
    Plug,
    Trash2,
    Users,
    X,
} from "lucide-react";
import type {Project, RunInfo} from "@loom/core";
import {api} from "../api/client.js";
import {AgentAvatar} from "../components/AgentAvatar.js";
import {Button, PageShell, Panel, StatusDot} from "../components/ui.js";
import {ConfirmDialog} from "../components/ConfirmDialog.js";
import {useI18n} from "../context/I18nContext.js";
import {cn} from "../lib/utils.js";

export function HomePage({
    onOpen,
    onOpenTab,
}: {
    onOpen: (projectId: string) => void;
    onOpenTab: (tab: "office" | "connections") => void;
}) {
    const {t} = useI18n();
    const qc = useQueryClient();
    const projects = useQuery({
        queryKey: ["projects"],
        queryFn: api.listProjects,
    });
    const [pendingDel, setPendingDel] = useState<{
        id: string;
        name: string;
    } | null>(null);
    const del = useMutation({
        mutationFn: (id: string) => api.deleteProject(id),
        onSuccess: () => void qc.invalidateQueries({queryKey: ["projects"]}),
    });

    const list = projects.data?.projects ?? [];
    // 관제센터 라이브 데이터 — 전 프로젝트 run 을 5초 폴링(백그라운드 탭에서도).
    const runsQ = useQuery({
        queryKey: ["runs", "all"],
        queryFn: api.listRunsAll,
        refetchInterval: 5_000,
        refetchIntervalInBackground: true,
    });
    const allRuns = runsQ.data?.runs ?? [];
    const running = allRuns.filter((r) => r.status === "running");

    return (
        <PageShell
            title={t("home.title")}
            subtitle={t("home.subtitle")}
            scrollable={false}
        >
            {/* IDE 3컬럼 미션 컨트롤 — 좌: 프로젝트 레일 · 중: 팀+활동 · 우: 비용+요약 */}
            <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto lg:overflow-hidden lg:grid-cols-[280px_1fr_320px] p-2">
                <ProjectsRail
                    projects={list}
                    running={running}
                    onOpen={onOpen}
                    onDelete={(p) => setPendingDel(p)}
                />
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <TeamBoard runs={running} projects={list} className="flex-1" />
                </div>
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <CostPanel />
                    <OfficeSummary onOpenTab={onOpenTab} />
                </div>
            </div>

            {pendingDel ? (
                <ConfirmDialog
                    icon={<Trash2 className="size-4.5" />}
                    tone="danger"
                    title={t("home.unregister")}
                    body={t("project.deleteConfirm", {name: pendingDel.name})}
                    confirmLabel={t("home.unregister")}
                    onConfirm={() => {
                        del.mutate(pendingDel.id);
                        setPendingDel(null);
                    }}
                    onCancel={() => setPendingDel(null)}
                />
            ) : null}
        </PageShell>
    );
}

// ── ProjectsRail — 좌측 컴팩트 프로젝트 리스트. 라이브 인디케이터 + 호버 액션. ─
function ProjectsRail({
    projects,
    running,
    onOpen,
    onDelete,
}: {
    projects: Project[];
    running: RunInfo[];
    onOpen: (id: string) => void;
    onDelete: (p: {id: string; name: string}) => void;
}) {
    const {t, lang} = useI18n();
    const isLive = (id: string) =>
        running.some((r) => r.projectId === id);
    const liveCount = (id: string) =>
        running.filter((r) => r.projectId === id).length;
    return (
        <aside className="flex min-h-0 flex-col rounded-3xl border border-border/20 bg-card/50 shadow-xl backdrop-blur-md">
            {/* 레일 헤더 — 28px 슬림 */}
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border/30 px-2 py-1.5">
                <FolderGit2 className="size-3.5 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                    {t("home.projects")}
                </span>
                <span className="rounded-full bg-muted/60 px-1.5 text-[9px] tabular-nums">
                    {projects.length}
                </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1">
                {projects.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                        {t("home.emptyTitle")}
                    </p>
                ) : null}
                {projects.map((p) => {
                    const live = liveCount(p.id);
                    return (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => onOpen(p.id)}
                            className={cn(
                                "group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
                                live > 0
                                    ? "bg-primary/5 ring-1 ring-primary/20 hover:bg-primary/10"
                                    : "hover:bg-muted/50",
                            )}
                        >
                            <span className="relative shrink-0">
                                <FolderGit2 className="size-3.5 text-muted-foreground group-hover:text-primary" />
                                {isLive(p.id) ? (
                                    <StatusDot
                                        tone="busy"
                                        className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card"
                                    />
                                ) : null}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                    {p.name}
                                </span>
                                <span className="block truncate font-mono text-[9px] text-muted-foreground">
                                    {p.path}
                                </span>
                            </span>
                            {live > 0 ? (
                                <span
                                    className="shrink-0 rounded-full bg-primary/15 px-1 text-[9px] font-medium tabular-nums text-primary"
                                    title={t("home.working", {n: String(live)})}
                                >
                                    {live}
                                </span>
                            ) : p.lastRunAt ? (
                                <span className="shrink-0 font-mono text-[8px] text-muted-foreground/60">
                                    {new Date(p.lastRunAt).toLocaleDateString(
                                        lang === "ko" ? "ko-KR" : "en-US",
                                        {month: "numeric", day: "numeric"},
                                    )}
                                </span>
                            ) : null}
                            <span
                                role="button"
                                tabIndex={0}
                                aria-label={t("home.unregister")}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete({id: p.id, name: p.name});
                                }}
                                className="absolute -right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                            >
                                <Trash2 className="size-3" />
                            </span>
                        </button>
                    );
                })}
            </div>
        </aside>
    );
}

// ── 팀 보드 — 누가 지금 어느 프로젝트에서 뭘 하고 있나 (관제센터의 심장) ─────────
function TeamBoard({
    runs,
    projects,
    className,
}: {
    runs: RunInfo[];
    projects: Project[];
    className?: string;
}) {
    const {t} = useI18n();
    const office = useQuery({queryKey: ["office"], queryFn: api.getOffice});
    const agents = office.data?.office.agents ?? [];
    const projName = (id: string | null) =>
        projects.find((p) => p.id === id)?.name ?? null;
    // 에이전트별 현재 running run(최신 1개).
    const liveOf = (name: string) =>
        runs
            .filter((r) => r.agent === name)
            .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
    const busy = runs.length;

    return (
        <Panel
            icon={<Users />}
            title={t("home.people")}
            count={agents.length}
            glow={busy > 0}
            className={className}
            actions={
                busy > 0 ? (
                    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <StatusDot tone="busy" />{" "}
                        {t("home.working", {n: String(busy)})}
                    </span>
                ) : null
            }
        >
            <div className="grid gap-1.5 sm:grid-cols-2 flex-1 min-h-0 overflow-y-auto pr-1">
                {agents.map((a) => {
                    const live = liveOf(a.name);
                    return (
                        <div
                            key={a.name}
                            className={cn(
                                "flex items-center gap-2.5 rounded-xl px-2.5 py-2",
                                live
                                    ? "bg-primary/5 ring-1 ring-primary/20"
                                    : ""
                            )}
                        >
                            <span className="relative shrink-0">
                                <AgentAvatar
                                    adapter={a.adapter}
                                    size={30}
                                    className="rounded-lg"
                                />
                                <StatusDot
                                    tone={live ? "busy" : "idle"}
                                    className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card"
                                />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-1.5">
                                    <span className="truncate text-sm font-medium">
                                        {a.label || a.name}
                                    </span>
                                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                                        {a.model || a.adapter}
                                    </span>
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                    {live
                                        ? `${
                                              projName(live.projectId)
                                                  ? `${projName(
                                                        live.projectId
                                                    )} · `
                                                  : ""
                                          }${live.prompt.split("\n")[0]}`
                                        : t("home.idle")}
                                </span>
                            </span>
                        </div>
                    );
                })}
                {agents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        {t("office.empty")}
                    </p>
                ) : null}
            </div>
        </Panel>
    );
}

// ── 비용 패널 — 30일 총액 + 월 예산 진행 + 에이전트 상위 막대 ────────────────────
function CostPanel({className}: {className?: string}) {
    const {t} = useI18n();
    const office = useQuery({queryKey: ["office"], queryFn: api.getOffice});
    const usage = useQuery({
        queryKey: ["usage"],
        queryFn: () => api.getUsage(30),
        staleTime: 60_000,
    });
    const u = usage.data;
    const topAgents = (u?.byAgent ?? []).slice(0, 4);
    const maxCost = Math.max(...topAgents.map((a) => a.costUsd), 0.0001);
    const adapterOf = (name: string) =>
        office.data?.office.agents.find((a) => a.name === name)?.adapter;

    return (
        <Panel icon={<CircleDollarSign className="text-success" />} title={t("home.usage")} className={className}>
            <div className="flex flex-col gap-2.5">
                <span className="flex items-baseline gap-2">
                    <span className="font-display text-2xl font-bold tabular-nums">
                        ${(u?.totals.costUsd ?? 0).toFixed(2)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                        {t("home.usageRuns", {n: String(u?.totals.runs ?? 0)})}
                    </span>
                </span>
                {u ? <BudgetLine month={u.month} /> : null}
                <span className="space-y-1">
                    {topAgents.map((a) => {
                        const adapter = adapterOf(a.agent);
                        return (
                            <span
                                key={a.agent}
                                className="flex items-center gap-1.5"
                            >
                                {adapter ? (
                                    <AgentAvatar
                                        adapter={adapter}
                                        size={14}
                                        className="rounded"
                                    />
                                ) : null}
                                <span className="w-16 truncate text-[10px] text-muted-foreground">
                                    @{a.agent}
                                </span>
                                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60">
                                    <span
                                        className="block h-full rounded-full bg-primary"
                                        style={{
                                            width: `${Math.max(
                                                4,
                                                (a.costUsd / maxCost) * 100
                                            )}%`,
                                        }}
                                    />
                                </span>
                                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                                    ${a.costUsd.toFixed(2)}
                                </span>
                            </span>
                        );
                    })}
                </span>
            </div>
        </Panel>
    );
}

// ── 오피스·연결 요약 — 양식 칩 + CLI 아이콘, 클릭으로 탭 이동 ────────────────────
function OfficeSummary({
    onOpenTab,
    className,
}: {
    onOpenTab: (tab: "office" | "connections") => void;
    className?: string;
}) {
    const {t} = useI18n();
    const office = useQuery({queryKey: ["office"], queryFn: api.getOffice});
    const o = office.data?.office;
    return (
        <Panel
            icon={<FileText />}
            title={t("home.forms")}
            className={cn("lg:self-start", className)}
            actions={
                <button
                    type="button"
                    onClick={() => onOpenTab("office")}
                    className="text-[10px] text-muted-foreground transition-colors hover:text-primary"
                >
                    {t("nav.office")} →
                </button>
            }
        >
            <div className="flex flex-col gap-3">
                <span className="flex flex-wrap gap-1.5 text-[11px]">
                    {o ? (
                        <>
                            <FormChip
                                label={t("office.section.rules")}
                                n={o.rules.length}
                            />
                            <FormChip
                                label={t("office.section.skills")}
                                n={o.skills.length}
                            />
                            <FormChip
                                label={t("office.section.workflows")}
                                n={o.workflows.length}
                            />
                            <FormChip label="MCP" n={o.mcp.length} />
                        </>
                    ) : (
                        "…"
                    )}
                </span>
                <button
                    type="button"
                    onClick={() => onOpenTab("connections")}
                    className="group flex items-center gap-1.5 text-left"
                >
                    <Plug className="size-3.5 text-primary" />
                    <span className="flex items-center gap-1.5">
                        {[
                            ...new Set((o?.agents ?? []).map((a) => a.adapter)),
                        ].map((ad) => (
                            <AgentAvatar
                                key={ad}
                                adapter={ad}
                                size={20}
                                className="rounded-md"
                            />
                        ))}
                    </span>
                    <span className="text-[10px] text-muted-foreground transition-colors group-hover:text-primary">
                        {t("nav.connections")} →
                    </span>
                </button>
            </div>
        </Panel>
    );
}

// 월 예산 진행 — office/budget.json. 카드(button) 안이라 편집 트리거는 span[role=button].
function BudgetLine({
    month,
}: {
    month: {costUsd: number; budgetUsd: number | null};
}) {
    const {t} = useI18n();
    const qc = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(month.budgetUsd?.toString() ?? "");
    const save = useMutation({
        // perAgent 한도를 덮어쓰지 않게 — 현재 값을 읽어 monthlyUsd 만 바꾼다.
        mutationFn: async (monthlyUsd: number | null) => {
            const cur = await api.getBudget();
            return api.putBudget({...cur.budget, monthlyUsd});
        },
        onSuccess: () => {
            setEditing(false);
            void qc.invalidateQueries({queryKey: ["usage"]});
        },
    });
    const pct = month.budgetUsd
        ? Math.min(100, (month.costUsd / month.budgetUsd) * 100)
        : 0;
    const tone =
        pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-success";

    if (editing) {
        return (
            <span
                className="flex items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
            >
                <input
                    autoFocus
                    inputMode="decimal"
                    value={value}
                    placeholder={t("home.budgetPh")}
                    onChange={(e) =>
                        setValue(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                    onKeyDown={(e) => {
                        if (e.key === "Enter")
                            save.mutate(value ? Number(value) : null);
                        if (e.key === "Escape") setEditing(false);
                    }}
                    className="h-6 w-20 rounded-md border border-primary/50 bg-background px-1.5 text-[11px] tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span
                    role="button"
                    tabIndex={0}
                    onClick={() => save.mutate(value ? Number(value) : null)}
                    className="rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"
                >
                    {save.isPending ? "…" : t("home.budgetSave")}
                </span>
            </span>
        );
    }
    if (month.budgetUsd == null) {
        return (
            <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                }}
                className="self-start rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
                + {t("home.budgetSet")}
            </span>
        );
    }
    return (
        <span
            className="flex items-center gap-1.5"
            onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
            }}
        >
            <span className="text-[10px] text-muted-foreground">
                {t("home.budgetMonth")}
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60">
                <span
                    className={cn("block h-full rounded-full", tone)}
                    style={{width: `${Math.max(3, pct)}%`}}
                />
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                ${month.costUsd.toFixed(2)} / ${month.budgetUsd}
            </span>
        </span>
    );
}

function FormChip({label, n}: {label: string; n: number}) {
    return (
        <span className="rounded-full border border-border px-2 py-0.5">
            {label} <span className="font-semibold tabular-nums">{n}</span>
        </span>
    );
}

// ── 프로젝트 추가 — 폴더 피커 + 이름 (홈·프로젝트 화면 공용) ─────────────────────
export function AddProject({
    onDone,
}: {
    onDone: (openedId: string | null) => void;
}) {
    const {t} = useI18n();
    const [picked, setPicked] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const create = useMutation({
        mutationFn: () => api.createProject(name.trim(), picked!),
        onSuccess: (r) => onDone(r.project.id),
        onError: (e) =>
            setErr(
                e instanceof Error
                    ? e.message.replace(/^\d+ [^:]+: /, "")
                    : String(e)
            ),
    });

    return (
        <div className="mt-6 rounded-2xl border border-primary/30 bg-card p-5">
            <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold">
                    {t("home.add")}
                </h2>
                <button
                    type="button"
                    onClick={() => onDone(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="close"
                >
                    <X className="size-4" />
                </button>
            </div>

            {picked === null ? (
                <FolderPicker
                    onPick={(p) => {
                        setPicked(p);
                        setName(p.split("/").pop() ?? "");
                    }}
                />
            ) : (
                <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <FolderOpen className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {picked}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPicked(null)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                        >
                            {t("home.repick")}
                        </button>
                    </div>
                    <input
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        value={name}
                        autoFocus
                        placeholder={t("project.name")}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            if (
                                e.key === "Enter" &&
                                !e.nativeEvent.isComposing &&
                                name.trim()
                            )
                                create.mutate();
                        }}
                    />
                    {err ? (
                        <p className="text-xs text-destructive">{err}</p>
                    ) : null}
                    <div className="flex justify-end">
                        <Button
                            size="sm"
                            disabled={!name.trim() || create.isPending}
                            onClick={() => create.mutate()}
                        >
                            {create.isPending ? "…" : t("project.addBtn")}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// 서버가 탐색해주는 로컬 폴더 브라우저 — 더블클릭 진입 없이 클릭=진입, 상단 줄에서 선택.
function FolderPicker({onPick}: {onPick: (path: string) => void}) {
    const {t} = useI18n();
    const [path, setPath] = useState<string | undefined>(undefined); // undefined = 홈
    const dirs = useQuery({
        queryKey: ["fs", path ?? "~"],
        queryFn: () => api.listDirs(path),
        placeholderData: (prev) => prev,
    });
    const d = dirs.data;

    return (
        <div className="mt-4">
            {/* 현재 위치 + 선택 */}
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <button
                    type="button"
                    title={t("picker.homeDir")}
                    onClick={() => setPath(d?.home)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                    <House className="size-4" />
                </button>
                <button
                    type="button"
                    title={t("picker.up")}
                    disabled={!d?.parent}
                    onClick={() => d?.parent && setPath(d.parent)}
                    className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                    <ArrowUp className="size-4" />
                </button>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {d?.path ?? "…"}
                </span>
                <Button
                    size="sm"
                    disabled={!d}
                    onClick={() => d && onPick(d.path)}
                >
                    <Check className="size-3.5" />
                    {t("picker.select")}
                </Button>
            </div>

            {/* 하위 폴더 */}
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
                {(d?.dirs ?? []).map((dir) => (
                    <button
                        key={dir.path}
                        type="button"
                        onClick={() => setPath(dir.path)}
                        className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted/60"
                    >
                        <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{dir.name}</span>
                        <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/50" />
                    </button>
                ))}
                {d && d.dirs.length === 0 ? (
                    <p
                        className={cn(
                            "px-3 py-4 text-center text-xs text-muted-foreground"
                        )}
                    >
                        {t("picker.empty")}
                    </p>
                ) : null}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("picker.hint")}
            </p>
        </div>
    );
}
