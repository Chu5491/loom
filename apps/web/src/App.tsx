// v2 셸 — 글래스 헤더(브랜드 + 탭 + 테마/언어) + 활성 화면.
// IA: 홈 = 프로젝트 대시보드 → 프로젝트에 "들어가면" 대화(depth 흐름).
// 오피스(팀 정의)·연결(CLI)은 전역이라 어디서든 탭으로.

import {useEffect, useRef, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {motion, AnimatePresence} from "framer-motion";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
    Bell,
    Check,
    ChevronDown,
    ChevronLeft,
    FolderGit2,
    House,
    Languages,
    Moon,
    Plug,
    RefreshCw,
    Sun,
    X,
    FolderCog,
} from "lucide-react";
import type {WorkflowGate} from "@loom/core";
import {api} from "./api/client.js";
import {AgentAvatar} from "./components/AgentAvatar.js";
import {CliStatus} from "./components/CliStatus.js";
import {CommandPalette} from "./components/CommandPalette.js";
import {ConfirmDialog} from "./components/ConfirmDialog.js";
import {ErrorBoundary} from "./components/ErrorBoundary.js";
import {LoomLogo} from "./components/LoomLogo.js";
import {Button, StatusDot} from "./components/ui.js";
import {useI18n} from "./context/I18nContext.js";
import {useTheme} from "./context/ThemeContext.js";
import {cn} from "./lib/utils.js";
import {ConnectionsPage} from "./pages/ConnectionsPage.js";
import {HomePage} from "./pages/HomePage.js";
import {OfficePage} from "./pages/OfficePage.js";
import {ProjectsPage} from "./pages/ProjectsPage.js";
import {TalkPage} from "./pages/TalkPage.js";

type Tab = "home" | "projects" | "office" | "connections";

export function App() {
    const {t, lang, setLang} = useI18n();
    const {effective, setMode} = useTheme();
    const qc = useQueryClient();
    const [tab, setTab] = useState<Tab>("home");
    // 헤더 프로젝트 칩 → 프로젝트 전환 메뉴(미션 컨트롤).
    const [switcherOpen, setSwitcherOpen] = useState(false);
    // 전환 확인 모달 — 드롭다운에서 다른 프로젝트를 고르면 여기 담고 묻는다.
    const [pendingSwitch, setPendingSwitch] = useState<{
        id: string;
        name: string;
    } | null>(null);
    const switcherRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!switcherOpen) return;
        const onDown = (e: MouseEvent) => {
            if (!switcherRef.current?.contains(e.target as Node))
                setSwitcherOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSwitcherOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [switcherOpen]);
    // ⌘K / Ctrl+K — 커맨드 팔레트.
    const [paletteOpen, setPaletteOpen] = useState(false);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen((o) => !o);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const [projectId, setProjectId] = useState<string | null>(
        () => localStorage.getItem("loom.project") || null
    );
    const setProject = (id: string | null) => {
        setProjectId(id);
        if (id) {
            localStorage.setItem("loom.project", id);
            setTab("home"); // 프로젝트 진입은 항상 홈 탭(대화)에서
        } else {
            localStorage.removeItem("loom.project");
        }
    };

    const projects = useQuery({
        queryKey: ["projects"],
        queryFn: api.listProjects,
    });
    const project =
        projects.data?.projects.find((p) => p.id === projectId) ?? null;
    // 등록 해제된 프로젝트가 localStorage 에 남아있으면 홈으로.
    // refetch 중엔 판단 보류 — 막 등록한 프로젝트가 옛 캐시에 없다고 되돌리는 레이스 방지.
    useEffect(() => {
        if (projects.isFetching || !projects.data) return;
        if (
            projectId &&
            !projects.data.projects.some((p) => p.id === projectId)
        ) {
            setProject(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projects.data, projects.isFetching, projectId]);

    const tabs: {key: Tab; label: string; icon: React.ReactNode}[] = [
        {key: "home", label: t("nav.home"), icon: <House className="size-4" />},
        {
            key: "projects",
            label: t("nav.projects"),
            icon: <FolderGit2 className="size-4" />,
        },
        {
            key: "office",
            label: t("nav.office"),
            icon: <FolderCog className="size-4" />,
        },
        {
            key: "connections",
            label: t("nav.connections"),
            icon: <Plug className="size-4" />,
        },
    ];

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background bg-grid-pattern">
            <header className="z-20 shrink-0 border-b border-border/40 bg-card/60 backdrop-blur-2xl">
                <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
                    <LoomLogo className="size-6 dark:invert" />
                    <span className="font-display text-base font-semibold">
                        {t("app.title")}
                    </span>

                    {/* 프로젝트 안 = 일터 — 회사 탭 대신 "회사 / 프로젝트" 브레드크럼. */}
                    {project && tab === "home" ? (
                        <div className="ml-3 flex min-w-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setProject(null)}
                                className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-all hover:bg-muted/70 hover:text-foreground"
                            >
                                {t("nav.company")}
                            </button>
                            <span className="select-none text-muted-foreground/40">
                                /
                            </span>
                        </div>
                    ) : (
                        <nav className="ml-3 flex items-center gap-1">
                            {tabs.map((tb) => (
                                <button
                                    key={tb.key}
                                    type="button"
                                    onClick={() => setTab(tb.key)}
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-all",
                                        tab === tb.key
                                            ? "bg-primary/15 text-foreground shadow-[var(--shadow-glow-sm)]"
                                            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                    )}
                                >
                                    {tb.icon}
                                    {tb.label}
                                </button>
                            ))}
                        </nav>
                    )}

                    {/* 프로젝트 안일 때 — 현재 위치 칩(누르면 프로젝트 전환 메뉴) */}
                    {project && tab === "home" ? (
                        <div ref={switcherRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setSwitcherOpen((o) => !o)}
                                title={t("nav.missionControl")}
                                className="flex min-w-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-3 text-sm shadow-[var(--shadow-glow-sm)] transition-all hover:bg-primary/20 hover:border-primary/60"
                            >
                                <FolderGit2 className="size-3.5 shrink-0 text-primary" />
                                <span className="max-w-44 truncate font-medium">
                                    {project.name}
                                </span>
                                <ChevronDown
                                    className={cn(
                                        "size-3.5 shrink-0 text-primary transition-transform",
                                        switcherOpen && "rotate-180"
                                    )}
                                />
                            </button>
                            {switcherOpen ? (
                                <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border bg-card p-1.5 shadow-lg">
                                    <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {t("nav.projects")}
                                    </p>
                                    {(projects.data?.projects ?? []).map(
                                        (p) => (
                                            <button
                                                key={p.id}
                                                type="button"
                                                onClick={() => {
                                                    setSwitcherOpen(false);
                                                    if (p.id !== project.id)
                                                        setPendingSwitch({
                                                            id: p.id,
                                                            name: p.name,
                                                        });
                                                }}
                                                className={cn(
                                                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                                                    p.id === project.id
                                                        ? "bg-primary/10"
                                                        : "hover:bg-muted/60"
                                                )}
                                            >
                                                <FolderGit2 className="size-3.5 shrink-0 text-primary" />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-medium">
                                                        {p.name}
                                                    </span>
                                                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                                        {p.path}
                                                    </span>
                                                </span>
                                                {p.id === project.id ? (
                                                    <Check className="size-3.5 shrink-0 text-primary" />
                                                ) : null}
                                            </button>
                                        )
                                    )}
                                    <div className="mt-1 border-t border-border/60 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSwitcherOpen(false);
                                                setProject(null);
                                            }}
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                                        >
                                            <ChevronLeft className="size-3.5 shrink-0" />
                                            {t("nav.backHome")}
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setPaletteOpen(true)}
                            title={t("cmdk.placeholder")}
                            className="hidden items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:flex"
                        >
                            <span>{t("cmdk.button")}</span>
                            <kbd className="rounded border border-border px-1 font-mono text-[10px]">
                                ⌘K
                            </kbd>
                        </button>
                        <GateBell />
                        <CliStatus
                            onOpenConnections={() => setTab("connections")}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="theme"
                            onClick={() =>
                                setMode(effective === "dark" ? "light" : "dark")
                            }
                        >
                            {effective === "dark" ? (
                                <Sun className="size-4" />
                            ) : (
                                <Moon className="size-4" />
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="language"
                            onClick={() => setLang(lang === "ko" ? "en" : "ko")}
                        >
                            <Languages className="size-4" />
                            <span className="text-xs uppercase">{lang}</span>
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => qc.invalidateQueries()}
                        >
                            <RefreshCw className="size-3.5" />
                            {t("conn.refreshAll")}
                        </Button>
                    </div>
                </div>
            </header>

            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                project={project}
                projects={projects.data?.projects ?? []}
                onTab={setTab}
                onProject={setProject}
            />

            {/* 프로젝트 전환 확인 모달 */}
            {pendingSwitch ? (
                <ConfirmDialog
                    icon={<FolderGit2 className="size-4.5" />}
                    title={t("nav.switchTitle")}
                    body={t("nav.switchConfirm", {name: pendingSwitch.name})}
                    confirmLabel={t("nav.switchGo")}
                    onConfirm={() => {
                        setProject(pendingSwitch.id);
                        setPendingSwitch(null);
                    }}
                    onCancel={() => setPendingSwitch(null)}
                />
            ) : null}

            <ErrorBoundary label={t("err.page")} retryLabel={t("err.retry")}>
                {/* 본문 + 펄스 레일 — flex row, 각자 h-full. 스크롤은 내부에서만. */}
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={project ? `proj-${project.id}` : tab}
                            initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
                            transition={{ duration: 0.22, ease: "easeOut" }}
                            className="min-h-0 min-w-0 flex-1"
                        >
                            {tab === "office" ? (
                                <OfficePage />
                            ) : tab === "connections" ? (
                                <ConnectionsPage />
                            ) : tab === "projects" ? (
                                <ProjectsPage onOpen={setProject} />
                            ) : project ? (
                                <TalkPage project={project} />
                            ) : (
                                <HomePage
                                    onOpen={setProject}
                                    onOpenTab={(tb) => setTab(tb)}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                    <PulseRail onJump={(projectId) => { if (projectId) setProject(projectId); setTab("home"); }} />
                </div>
            </ErrorBoundary>
        </div>
    );
}

// ── GateBell — 전역 대기 게이트. Talk 은 스레드 스코프라 스케줄 발 워크플로우의
// 게이트(threadId 없음)는 어디서도 안 보여 영구 대기했다 — 헤더 벨이 전부를 모은다.
function GateBell() {
    const { t } = useI18n();
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const gates = useQuery({
        queryKey: ["gates", "all"],
        queryFn: api.listAllGates,
        refetchInterval: 5000,
    });
    const list: WorkflowGate[] = gates.data?.gates ?? [];
    // 새 게이트 = "막혀서 반드시 처리해야 하는" 이벤트 — 탭을 안 보고 있어도 알도록
    // 브라우저 알림. 게이트는 못 보면 워크플로우 전체가 영구 정지하므로 노이즈 가치 충분.
    const notified = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (typeof Notification === "undefined") return;
        if (Notification.permission === "default") void Notification.requestPermission();
        if (Notification.permission !== "granted") {
            list.forEach((g) => notified.current.add(g.id)); // 권한 없으면 조용히 기억만
            return;
        }
        for (const g of list) {
            if (notified.current.has(g.id)) continue;
            notified.current.add(g.id);
            try {
                new Notification(t("gate.pending"), { body: `${g.workflow} · ${g.nodeId}`, tag: g.id });
            } catch {
                // 알림 생성 실패(일부 환경) — 무해
            }
        }
        // 해소된 게이트는 기억에서 비워 Set 무한 성장 방지(현재 목록만 유지).
        notified.current = new Set([...notified.current].filter((id) => list.some((g) => g.id === id)));
    }, [list, t]);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [open]);
    const decide = (id: string, ok: boolean) => {
        void (ok ? api.approveGate(id) : api.rejectGate(id)).then(() => {
            void qc.invalidateQueries({ queryKey: ["gates"] });
            void qc.invalidateQueries({ queryKey: ["runs"] });
        });
    };
    if (list.length === 0) return null;
    return (
        <div className="relative" ref={ref}>
            <Button variant="ghost" size="sm" aria-label={t("gate.pending")} onClick={() => setOpen((o) => !o)}>
                <span className="relative">
                    <Bell className="size-4" />
                    <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-warning text-[9px] font-bold text-white">
                        {list.length}
                    </span>
                </span>
            </Button>
            {open ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-xl border border-border bg-popover p-2 shadow-lg">
                    <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("gate.pending")} · {list.length}
                    </p>
                    {list.map((g) => (
                        <div key={g.id} className="rounded-lg p-2 hover:bg-muted/50">
                            <p className="truncate text-xs font-medium">{g.workflow}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{g.nodeId} · {g.result.slice(0, 60) || "—"}</p>
                            <div className="mt-1.5 flex gap-1.5">
                                <Button variant="secondary" size="sm" onClick={() => decide(g.id, true)}>
                                    <Check className="size-3" />{t("talk.gate.approve")}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => decide(g.id, false)}>
                                    <X className="size-3" />{t("talk.gate.reject")}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// ── PulseRail — 페이지 무관, 라이브로 도는 run 을 우측에 상시 표시.
// 호버 시 Radix Portal 툴팁(overflow 무관)으로 정보 노출. 클릭 → 그 프로젝트의 Talk.
function PulseRail({ onJump }: { onJump: (projectId: string | null) => void }) {
    const { t } = useI18n();
    const runs = useQuery({
        queryKey: ["runs", "all"],
        queryFn: api.listRunsAll,
        refetchInterval: 5_000,
        refetchIntervalInBackground: true,
    });
    const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
    const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

    const agents = office.data?.office.agents ?? [];
    const projList = projects.data?.projects ?? [];
    const live = (runs.data?.runs ?? []).filter((r) => r.status === "running");
    const projName = (id: string | null | undefined) =>
        id ? projList.find((p) => p.id === id)?.name ?? null : null;

    return (
        <Tooltip.Provider delayDuration={120} skipDelayDuration={200}>
            {/* 슬림 레일 — 부모 flex row 에서 h-full 을 자연스럽게 받음. calc 불필요. */}
            <aside
                className="hidden h-full w-11 shrink-0 flex-col items-center gap-1.5 border-l border-border/40 bg-card/30 py-2 backdrop-blur-md lg:flex"
                aria-label={t("pulse.title")}
            >
                {live.length === 0 ? (
                    <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                            <span className="mt-1 size-1.5 cursor-default rounded-full bg-muted-foreground/30" />
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                            <Tooltip.Content
                                side="left"
                                sideOffset={8}
                                className="z-50 rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground shadow-lg"
                            >
                                {t("pulse.idle")}
                            </Tooltip.Content>
                        </Tooltip.Portal>
                    </Tooltip.Root>
                ) : (
                    <span
                        className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[9px] font-semibold tabular-nums text-primary shadow-[var(--shadow-glow-sm)]"
                        title={t("pulse.title")}
                    >
                        {live.length}
                    </span>
                )}
                {/* 아바타 스택 — 최대 14, 넘으면 +N */}
                <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto pb-1">
                    {live.slice(0, 14).map((run) => {
                        const agent = agents.find((a) => a.name === run.agent);
                        const proj = projName(run.projectId);
                        return (
                            <Tooltip.Root key={run.id}>
                                <Tooltip.Trigger asChild>
                                    <button
                                        type="button"
                                        onClick={() => onJump(run.projectId ?? null)}
                                        className="group relative shrink-0"
                                    >
                                        <AgentAvatar
                                            adapter={agent?.adapter ?? "claude-code"}
                                            size={26}
                                            className="rounded-lg ring-2 ring-primary/40 shadow-[var(--shadow-glow-sm)] transition-transform group-hover:scale-110"
                                        />
                                        <StatusDot
                                            tone="busy"
                                            className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card"
                                        />
                                    </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                    <Tooltip.Content
                                        side="left"
                                        sideOffset={8}
                                        className="z-50 w-64 rounded-xl border border-border bg-card p-3 text-left shadow-lg"
                                    >
                                        <p className="truncate text-xs font-semibold">
                                            @{run.agent}
                                        </p>
                                        {proj ? (
                                            <p className="mt-0.5 truncate text-[10px] font-medium text-primary">
                                                {proj}
                                            </p>
                                        ) : null}
                                        <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                                            {run.prompt.split("\n")[0] ?? ""}
                                        </p>
                                    </Tooltip.Content>
                                </Tooltip.Portal>
                            </Tooltip.Root>
                        );
                    })}
                    {live.length > 14 ? (
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                            +{live.length - 14}
                        </span>
                    ) : null}
                </div>
            </aside>
        </Tooltip.Provider>
    );
}
