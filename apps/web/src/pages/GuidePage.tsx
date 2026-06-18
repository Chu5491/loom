// 가이드 — 인앱 사용 설명서. 코드 분석으로 검증한 동작(특히 디스패치/위임)을
// 한곳에 정리한다. 라우터 없는 셸이라 좌측 섹션 점프 + 우측 스크롤 본문.
// 본문은 양언어 데이터(blocks) → 미니 렌더러. 거대한 i18n 키 대신 콘텐츠 모델.

import {useState, useEffect, useRef} from "react";
import {
    BookOpen,
    Rocket,
    Building2,
    MessagesSquare,
    Compass,
    Share2,
    Workflow as WorkflowIcon,
    CalendarClock,
    GitCompare,
    Terminal,
    Wallet,
} from "lucide-react";
import {useI18n} from "../context/I18nContext.js";
import {cn} from "../lib/utils.js";

type Block =
    | {h: string}
    | {p: string}
    | {ul: string[]}
    | {steps: string[]}
    | {code: string}
    | {note: string}
    | {flow: string[]}
    | {table: {head: string[]; rows: string[][]}};

interface Section {
    id: string;
    icon: React.ReactNode;
    title: string;
    blocks: Block[];
}

// **굵게** 와 `코드` 만 지원하는 인라인 렌더 — 본문 문장용.
function Inline({text}: {text: string}) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
        <>
            {parts.map((p, i) => {
                if (p.startsWith("**") && p.endsWith("**"))
                    return (
                        <strong key={i} className="font-semibold text-foreground">
                            {p.slice(2, -2)}
                        </strong>
                    );
                if (p.startsWith("`") && p.endsWith("`"))
                    return (
                        <code
                            key={i}
                            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
                        >
                            {p.slice(1, -1)}
                        </code>
                    );
                return <span key={i}>{p}</span>;
            })}
        </>
    );
}

function BlockView({block}: {block: Block}) {
    if ("h" in block)
        return (
            <h3 className="mt-7 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
                {block.h}
            </h3>
        );
    if ("p" in block)
        return (
            <p className="my-2 text-sm leading-relaxed text-foreground/90">
                <Inline text={block.p} />
            </p>
        );
    if ("ul" in block)
        return (
            <ul className="my-2 space-y-1.5">
                {block.ul.map((li, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                        <span>
                            <Inline text={li} />
                        </span>
                    </li>
                ))}
            </ul>
        );
    if ("steps" in block)
        return (
            <ol className="my-3 space-y-2">
                {block.steps.map((li, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                            {i + 1}
                        </span>
                        <span className="pt-0.5">
                            <Inline text={li} />
                        </span>
                    </li>
                ))}
            </ol>
        );
    if ("code" in block)
        return (
            <pre className="my-3 overflow-x-auto rounded-lg border border-border/50 bg-muted/50 p-3 text-[12px] leading-relaxed">
                <code className="font-mono text-foreground/90">{block.code}</code>
            </pre>
        );
    if ("note" in block)
        return (
            <div className="my-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm leading-relaxed text-foreground/90">
                <Inline text={block.note} />
            </div>
        );
    if ("flow" in block)
        return (
            <div className="my-3 flex flex-wrap items-center gap-1.5">
                {block.flow.map((step, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                        <span className="rounded-md border border-border/60 bg-card px-2 py-1 text-[12px] font-medium text-foreground/90">
                            <Inline text={step} />
                        </span>
                        {i < block.flow.length - 1 && (
                            <span className="text-muted-foreground/50">→</span>
                        )}
                    </span>
                ))}
            </div>
        );
    // table
    return (
        <div className="my-3 overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full border-collapse text-[13px]">
                <thead>
                    <tr className="bg-muted/50">
                        {block.table.head.map((h, i) => (
                            <th
                                key={i}
                                className="border-b border-border/50 px-3 py-2 text-left font-semibold text-foreground"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {block.table.rows.map((row, r) => (
                        <tr key={r} className="even:bg-muted/20">
                            {row.map((cell, c) => (
                                <td
                                    key={c}
                                    className="border-b border-border/30 px-3 py-2 align-top text-foreground/90 last:border-0"
                                >
                                    <Inline text={cell} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function sections(lang: "ko" | "en"): Section[] {
    const ko = lang === "ko";
    return [
        {
            id: "intro",
            icon: <BookOpen className="size-4" />,
            title: ko ? "큰 그림" : "Big picture",
            blocks: ko
                ? [
                      {p: "loom 은 여러 CLI 에이전트(claude · antigravity · codex · opencode · devin)를 **한 오피스에서 같이 부리는** 협업 도구예요. 핵심은 두 개념의 분리입니다."},
                      {ul: [
                          "**오피스(Office)** = 팀의 정의. 규약·스킬·MCP·에이전트·워크플로우. **git 에 커밋**되는 전역 공유물 — \"어떤 팀인가\".",
                          "**프로젝트(Project)** = 일터. 등록한 로컬 디렉토리이고 run 의 작업 폴더(cwd). 머신마다 다름 — \"어디서 일하나\".",
                      ]},
                      {p: "그래서 오피스는 한 번 잘 짜두면 어느 프로젝트에서든 같은 팀을 부를 수 있어요."},
                      {h: "헌법 5원칙"},
                      {ul: [
                          "**CLI 그대로** — 래핑하되 변형하지 않는다.",
                          "**자동 주입은 죄** — 당신이 적은 prompt + 명시적으로 붙인 spec 이 입력의 전부. 어댑터가 몰래 끼워넣지 않는다.",
                          "**CLI root 불가침** — `~/.claude` 같은 전역 설정을 건드리지 않는다. 주입은 run 별 loadout/플래그로.",
                          "**정의는 git, 기록은 로컬** — `office/` 는 커밋, `data/`(sqlite·로그·loadout)는 gitignore.",
                          "**Raw 는 진실, Parsed 는 경험** — CLI 원본 출력은 항상 디스크 보존, 화면은 그 위의 뷰.",
                      ]},
                  ]
                : [
                      {p: "loom orchestrates several CLI agents (claude · antigravity · codex · opencode · devin) in **one shared office**. The core idea is the split of two concepts."},
                      {ul: [
                          "**Office** = the team definition: rules, skills, MCP, agents, workflows. **Committed to git**, globally shared — \"who the team is\".",
                          "**Project** = where work happens: a registered local directory used as each run's cwd. Machine-local — \"where you work\".",
                      ]},
                      {p: "Define the office once and you can summon the same team from any project."},
                      {h: "The 5 principles"},
                      {ul: [
                          "**CLI as-is** — wrap, never mutate.",
                          "**Auto-injection is sin** — your prompt + the spec you explicitly attach is the whole input. No adapter sneaks anything in.",
                          "**CLI root is sacred** — never touch global config like `~/.claude`. Injection happens per-run via loadout/flags.",
                          "**Definitions in git, records local** — `office/` is committed; `data/` (sqlite, logs, loadout) is gitignored.",
                          "**Raw is truth, parsed is experience** — raw CLI output is always kept on disk; the UI is a view on top.",
                      ]},
                  ],
        },
        {
            id: "quickstart",
            icon: <Rocket className="size-4" />,
            title: ko ? "빠른 시작" : "Quick start",
            blocks: ko
                ? [
                      {steps: [
                          "**연결(Connections)** 탭에서 쓸 CLI 가 로그인됐는지 확인 (각 CLI 는 자기 인증을 그대로 씀 — BYOK).",
                          "**프로젝트(Projects)** 탭에서 일할 로컬 폴더를 등록.",
                          "**오피스(Office)** 탭에서 에이전트를 하나 만든다 — CLI + 모델 + 끌고 갈 규약/스킬/MCP 선택.",
                          "프로젝트로 들어가 **대화(Talk)** 에서 일을 시킨다. 에이전트가 그 폴더에서 작업하고, 결과를 작업 리포트 카드로 돌려줌.",
                      ]},
                      {note: "처음이면 에이전트 하나 + 프로젝트 하나로 시작해서, 익숙해지면 워크플로우·위임·스케줄로 넓혀가면 됩니다."},
                  ]
                : [
                      {steps: [
                          "In **Connections**, confirm the CLIs you want are logged in (each CLI uses its own auth — BYOK).",
                          "In **Projects**, register the local folder you'll work in.",
                          "In **Office**, create an agent — pick its CLI + model + the rules/skills/MCP it carries.",
                          "Enter the project and assign work in **Talk**. The agent works in that folder and returns a work-report card.",
                      ]},
                      {note: "Start with one agent and one project. Once comfortable, expand into workflows, delegation, and schedules."},
                  ],
        },
        {
            id: "office",
            icon: <Building2 className="size-4" />,
            title: ko ? "오피스 구성요소" : "Office building blocks",
            blocks: ko
                ? [
                      {p: "오피스는 `office/` 폴더 = 코드(이름이 곧 식별자, id/timestamp 없음). 오피스 탭에서 GUI 로 편집하면 그대로 파일에 저장돼요."},
                      {table: {head: ["요소", "무엇", "파일"], rows: [
                          ["**규약(rules)**", "항상 붙는 팀 규칙", "`office/rules/<name>.md`"],
                          ["**스킬(skills)**", "필요할 때 펼쳐 쓰는 능력. 본문은 인덱스만 주입, 에이전트가 필요할 때 Read", "`office/skills/<name>.md`"],
                          ["**MCP**", "도구 서버. secret 은 `${ENV}` 참조", "`office/mcp/servers.json`"],
                          ["**에이전트(agents)**", "CLI + 모델 + 끌고 갈 규약/스킬/MCP + 역할(+위임 여부)", "`office/agents/<name>.json`"],
                          ["**워크플로우**", "노드(에이전트+프롬프트) 그래프 + 트리거", "`office/workflows/<name>.json`"],
                          ["**예산**", "월 상한(USD, 전체+에이전트별)", "`office/budget.json`"],
                      ]}},
                      {note: "**자동 주입은 죄** 원칙 — 에이전트가 \"끌고 가도록 명시한\" 규약·스킬·MCP 만 그 run 에 실립니다. 그 외엔 아무것도 안 붙어요."},
                  ]
                : [
                      {p: "The office is the `office/` folder = code (the name is the identifier; no id/timestamp). Editing in the Office tab via GUI saves straight to files."},
                      {table: {head: ["Block", "What", "File"], rows: [
                          ["**rules**", "Team rules always attached", "`office/rules/<name>.md`"],
                          ["**skills**", "Abilities expanded on demand — only an index is injected; the agent Reads the body when needed", "`office/skills/<name>.md`"],
                          ["**MCP**", "Tool servers. Secrets via `${ENV}`", "`office/mcp/servers.json`"],
                          ["**agents**", "CLI + model + the rules/skills/MCP it carries (+delegate, +master)", "`office/agents/<name>.json`"],
                          ["**workflows**", "A node (agent+prompt) graph + triggers", "`office/workflows/<name>.json`"],
                          ["**budget**", "Monthly cap (USD, total + per-agent)", "`office/budget.json`"],
                      ]}},
                      {note: "**Auto-injection is sin** — only the rules/skills/MCP an agent *explicitly* carries ride along on its run. Nothing else is attached."},
                  ],
        },
        {
            id: "talk",
            icon: <MessagesSquare className="size-4" />,
            title: ko ? "대화 & 작업 리포트" : "Talk & work reports",
            blocks: ko
                ? [
                      {p: "프로젝트에 들어가면 홈이 **Talk 워크스페이스**가 돼요 — 스레드 독 + 작업 스테이지 + 팀 패널."},
                      {ul: [
                          "**스레드** = 대화 단위. 같은 스레드의 연속 턴은 CLI 세션(`sessionId`)이 이어져 맥락을 기억합니다.",
                          "**작업 중 패널** — 에이전트가 일하는 동안 아바타 펄스 + \"@에이전트 작업 중\" + 현재 동작 + 경과 시간 + 진행 바로 \"지금 이 프로젝트에서 일하는 중\"을 보여줘요.",
                          "**작업 리포트 카드** — 단순 채팅이 아니라 한 일·쓴 도구·만진 파일·결정·비용·소요시간을 카드로 정리. 시스템이 파싱한 정보(도구·파일·비용)와 에이전트가 적은 요약(`loom-report` 블록)을 합칩니다.",
                      ]},
                      {note: "리포트 카드는 `office/rules/global.md` 규칙으로 동작해요 — 에이전트가 작업 턴 끝에 정해진 JSON 블록을 붙이게 한 거라 5개 CLI 어디서나 같은 카드가 나옵니다(평문 출력 CLI 포함)."},
                      {h: "질문은 턴 끝에"},
                      {p: "헤드리스(비대화형) 실행이라 에이전트는 **중간에 대화형 질문 도구를 띄우지 않고**, 막히면 작업 턴을 끝낸 뒤 질문을 돌려줘요. 답을 주면 같은 스레드에서 이어집니다."},
                  ]
                : [
                      {p: "Inside a project, Home becomes the **Talk workspace** — thread dock + work stage + team panel."},
                      {ul: [
                          "**Threads** = conversation units. Consecutive turns in one thread keep the CLI session (`sessionId`), preserving context.",
                          "**Working panel** — while an agent works, a pulsing avatar + \"@agent working\" + current action + elapsed time + progress bar make it obvious it's working in *this* project right now.",
                          "**Work-report card** — not plain chat but a card of what was done, tools used, files touched, decisions, cost, and duration. It merges system-parsed info (tools/files/cost) with the agent's own summary (a `loom-report` block).",
                      ]},
                      {note: "The report card is driven by a rule in `office/rules/global.md` — agents append a fixed JSON block at the end of a work turn, so the same card appears across all 5 CLIs (including plain-text ones)."},
                      {h: "Questions come at turn's end"},
                      {p: "Runs are headless, so agents **never pop interactive question dialogs mid-run** — if blocked, they finish the turn and return the question. Answer it and the same thread continues."},
                  ],
        },
        {
            id: "dispatch",
            icon: <Compass className="size-4" />,
            title: ko ? "디스패치 (적임자 추천)" : "Dispatch (who should do it)",
            blocks: ko
                ? [
                      {p: "**디스패치는 \"이 일은 누가 맡으면 좋을까\"를 추천하는 라우팅**이에요. 작업 텍스트와 각 에이전트를 비교해 점수를 매깁니다. (`run/dispatch.ts`, 순수 함수)"},
                      {h: "점수 매기는 법"},
                      {ul: [
                          "작업 텍스트를 단어로 쪼개고, 에이전트 쪽 단어와 겹치는 만큼 점수.",
                          "에이전트 **자기소개(label·prompt)** 와 겹치면 단어당 **1점**.",
                          "에이전트가 보유한 **스킬 이름·설명** 과 겹치면 단어당 **2점** (전문성 신호라 가중치 ↑).",
                          "최고점이 적임자. 동점이면 정의 순서, 모두 0점이면 첫 에이전트로 폴백.",
                      ]},
                      {note: "**라우팅일 뿐 주입이 아니에요.** 디스패치가 에이전트를 고르더라도, 당신이 적은 프롬프트는 그대로 그 에이전트에게 갑니다. 점수가 못 가를 땐 LLM 라우터가 후속 후보."},
                  ]
                : [
                      {p: "**Dispatch recommends \"who should take this task\"** — it's routing. It scores each agent against the task text. (`run/dispatch.ts`, a pure function.)"},
                      {h: "How scoring works"},
                      {ul: [
                          "Split the task into words; score by overlap with each agent's words.",
                          "Overlap with the agent's **self-intro (label·prompt)** = **1 point** per word.",
                          "Overlap with the agent's **skill names/descriptions** = **2 points** per word (expertise signal, weighted higher).",
                          "Highest score wins; ties go by definition order; all-zero falls back to the first agent.",
                      ]},
                      {note: "**It's routing, not injection.** Even when dispatch picks an agent, your prompt goes to it verbatim. When scores can't decide, an LLM router is the follow-up tiebreaker."},
                  ],
        },
        {
            id: "delegation",
            icon: <Share2 className="size-4" />,
            title: ko ? "자동 위임 (작업 중 넘기기)" : "Delegation (hand off mid-task)",
            blocks: ko
                ? [
                      {p: "**위임은 디스패치와 달라요.** 디스패치는 *시작 전* 누구에게 줄지 고르는 것, 위임은 한 에이전트가 **일하다가** 더 적합한 팀원에게 하위 작업을 **직접 넘기는** 것이에요."},
                      {h: "켜는 법"},
                      {p: "에이전트 정의에서 `delegate: true` 로 옵트인한 에이전트만 위임 능력을 갖습니다. 켜면 그 run 에 팀원 명단이 실려요."},
                      {h: "어떻게 실리나 (CLI 별로 다름)"},
                      {ul: [
                          "**MCP 지원 CLI**(claude·codex·opencode 등) → loadout 에 loom 의 `delegate` MCP 도구가 붙음. 도구 설명에 팀원 명단(이름·CLI·모델·소개)이 들어 있어 모델이 적임자를 직접 고름. 권한 프롬프트 없이 호출되도록 자동 허용(`mcp__loom__delegate`).",
                          "**MCP 불가 CLI**(antigravity) → loadout 에 셸 브리지 `delegate.sh <팀원> <작업>` 을 싣고, 그게 서버로 POST.",
                          "어느 쪽이든 **runId 가 박혀 있어** \"누가 위임하는지\"를 서버가 알고, 자식 run 에 부모/스레드/프로젝트를 상속시킵니다.",
                      ]},
                      {h: "넘어가는 흐름"},
                      {flow: ko ? ["에이전트 A 작업 중", "`delegate(B, 작업)` 호출", "부모 스트림에 → @B 표시", "B 자식 run 시작", "B 결과를 A 에게 반환", "A 가 이어서 마무리"] : []},
                      {p: "자식의 출력은 신뢰 불가로 보고 **데이터 펜스로 감싸** 부모에게 돌려줘요(워크플로우 핸드오프와 같은 정책). 부모 화면엔 `→ @B (위임)` 이 라이브로 그려집니다."},
                      {h: "안전장치 (무한 위임 방지)"},
                      {ul: [
                          "**자기 자신에게 위임 불가.**",
                          "**위임 깊이 최대 5단계** (A→B→C…). 넘으면 거부.",
                          "**부모당 동시 위임 3건** 까지. 넘으면 \"끝날 때까지 대기\".",
                          "**자식 타임아웃 10분.** 넘으면 자식을 취소해 고아 run 을 막음.",
                          "거대한 작업 텍스트는 잘라서(cap) 자식 토큰을 잡아먹지 않게 함.",
                      ]},
                      {note: "정리: **디스패치 = 시작 전 라우팅 추천**, **위임 = 실행 중 에이전트끼리 협업**. 둘 다 \"누가 적임자냐\"를 다루지만 시점과 주체가 달라요."},
                  ]
                : [
                      {p: "**Delegation differs from dispatch.** Dispatch picks who to assign *before* starting; delegation is one agent **mid-work** handing a sub-task **directly** to a better-suited teammate."},
                      {h: "Turning it on"},
                      {p: "Only agents that opt in with `delegate: true` get the ability. When on, the run carries the teammate roster."},
                      {h: "How it's wired (varies by CLI)"},
                      {ul: [
                          "**MCP-capable CLIs** (claude·codex·opencode…) → loom's `delegate` MCP tool is added to the loadout. Its description embeds the roster (name·CLI·model·intro) so the model picks. Auto-allowed so it runs without a permission prompt (`mcp__loom__delegate`).",
                          "**MCP-incapable CLIs** (antigravity) → a shell bridge `delegate.sh <teammate> <task>` is placed in the loadout, which POSTs to the server.",
                          "Either way the **runId is baked in**, so the server knows *who* is delegating and the child run inherits parent/thread/project.",
                      ]},
                      {h: "The hand-off flow"},
                      {flow: ["Agent A working", "calls `delegate(B, task)`", "→ @B shown in parent stream", "B child run starts", "B's result returned to A", "A finishes"]},
                      {p: "The child's output is treated as untrusted and **wrapped in a data fence** back to the parent (same policy as workflow hand-offs). `→ @B (delegated)` is drawn live in the parent's view."},
                      {h: "Safety rails (no runaway delegation)"},
                      {ul: [
                          "**Cannot delegate to self.**",
                          "**Max delegation depth 5** (A→B→C…). Beyond that, rejected.",
                          "**Up to 3 concurrent delegations per parent.** Beyond that, \"wait until one finishes\".",
                          "**10-minute child timeout.** Past it, the child is cancelled to avoid orphan runs.",
                          "Huge task text is capped so it doesn't eat the child's tokens.",
                      ]},
                      {note: "In short: **dispatch = pre-start routing suggestion**, **delegation = agent-to-agent collaboration at runtime**. Both ask \"who's best\" but at different times and by different actors."},
                  ],
        },
        {
            id: "workflow",
            icon: <WorkflowIcon className="size-4" />,
            title: ko ? "워크플로우 & 게이트" : "Workflows & gates",
            blocks: ko
                ? [
                      {p: "워크플로우는 **다단계 그래프** — 노드(에이전트+프롬프트)를 엣지로 잇습니다. 엣지는 success/fail/always 로 분기하고, `{{input}}`·`{{result}}` 로 이전 결과를 다음 프롬프트에 끼워요."},
                      {ul: [
                          "노드 `kind: \"gate\"` = **휴먼 게이트**. 사람이 승인(success)/거부(fail)할 때까지 멈춤. 대기 목록은 헤더의 종 아이콘에 떠요.",
                          "시작 방법 ① Talk 의 수동 버튼 ② 트리거 — 에이전트 run 종료 시 자동(즉시) 또는 제안(UI 버튼) ③ 스케줄.",
                          "루프 방어: 체인 홉 최대 5, 워크플로우 스텝 최대 20.",
                      ]},
                      {note: "게이트 대기 목록은 인메모리예요 — 서버를 재시작하면 사라집니다."},
                  ]
                : [
                      {p: "A workflow is a **multi-stage graph** — nodes (agent+prompt) joined by edges. Edges branch on success/fail/always, and `{{input}}`·`{{result}}` splice prior output into the next prompt."},
                      {ul: [
                          "A `kind: \"gate\"` node = **human gate**. It pauses until a person approves (success) / rejects (fail). The waiting list shows on the header bell.",
                          "Start via ① Talk's manual button ② triggers — on run end, auto (immediate) or suggested (UI button) ③ schedule.",
                          "Loop guards: max 5 chain hops, max 20 workflow steps.",
                      ]},
                      {note: "The gate waiting list is in-memory — it's lost on server restart."},
                  ],
        },
        {
            id: "schedule",
            icon: <CalendarClock className="size-4" />,
            title: ko ? "스케줄 & 스탠드업" : "Schedules & standup",
            blocks: ko
                ? [
                      {ul: [
                          "**스케줄** — cron 으로 run/워크플로우를 정기 발화. 서버 프로세스가 떠 있는 동안만, 머신-로컬. 직전 run 이 아직 돌면 그 tick 은 건너뜀.",
                          "**스탠드업** — `feature: \"standup\"` 스케줄. 지난 24시간의 run 기록 + git log 를 근거로 데일리 리포트를 만들어요. 프롬프트는 `office/prompts/` 에서 손질 가능.",
                      ]},
                  ]
                : [
                      {ul: [
                          "**Schedules** — fire runs/workflows on a cron. Only while the server process is up; machine-local. If the previous run is still going, that tick is skipped.",
                          "**Standup** — a `feature: \"standup\"` schedule. Builds a daily report grounded in the last 24h of runs + git log. Its prompt lives in `office/prompts/` for tweaking.",
                      ]},
                  ],
        },
        {
            id: "files",
            icon: <GitCompare className="size-4" />,
            title: ko ? "변경 리뷰 보드" : "Changes review board",
            blocks: ko
                ? [
                      {p: "프로젝트의 **파일** 탭은 두 모드예요 — `[트리]` 로 폴더를 훑거나 `[변경]` 으로 작업 결과를 리뷰."},
                      {ul: [
                          "**변경 보드** — git 기준으로 추가/수정/삭제된 파일과 `+N/-M` 증감을 보여줘요(5초마다 갱신).",
                          "**누가 만졌나** — 에이전트가 고친 파일이면 그 아바타 + `@에이전트명`(여럿이면 +N)을 표시. run 의 파일 이벤트로 귀속합니다.",
                          "사람/IDE 가 직접 고친 파일은 run 이 아니라 귀속이 없어 경로만 떠요(정직한 한계).",
                      ]},
                      {note: "평문 출력 CLI(antigravity·devin)는 도구 단계를 못 흘려서, run 완료 시 git 으로 만진 파일을 잡아 파일 귀속을 채웁니다."},
                  ]
                : [
                      {p: "A project's **Files** tab has two modes — `[tree]` to browse folders or `[changes]` to review work."},
                      {ul: [
                          "**Changes board** — shows files added/edited/deleted per git, with `+N/-M` line deltas (refreshes every 5s).",
                          "**Who touched it** — if an agent edited a file, its avatar + `@agent` (+N for several) is shown, attributed via the run's file events.",
                          "Files edited directly by a human/IDE aren't from a run, so there's no attribution — just the path (an honest limit).",
                      ]},
                      {note: "Plain-text CLIs (antigravity·devin) can't stream tool steps, so on run completion loom captures git-touched files to fill in file attribution."},
                  ],
        },
        {
            id: "cli",
            icon: <Terminal className="size-4" />,
            title: ko ? "5 CLI 지원 매트릭스" : "5-CLI support matrix",
            blocks: ko
                ? [
                      {p: "각 CLI 는 자기 인증을 그대로 쓰고(BYOK), loom 은 차이를 어댑터로 흡수해요. 능력 차이는 솔직히 드러냅니다."},
                      {table: {head: ["CLI", "도구 단계", "MCP 주입", "위임"], rows: [
                          ["claude-code", "✅ JSON 스트림", "✅ `--mcp-config`", "✅ MCP 도구"],
                          ["codex", "✅ JSON 스트림", "✅ `-c mcp_servers`", "✅ MCP 도구"],
                          ["opencode", "✅ JSON 스트림", "✅ XDG 리다이렉트", "✅ MCP 도구"],
                          ["antigravity", "⚠️ 평문", "❌ (CLI 한계)", "✅ 셸 브리지"],
                          ["devin", "⚠️ 평문", "✅ 프로젝트-로컬 파일", "✅"],
                      ]}},
                      {note: "평문 CLI 는 도구 호출을 라이브로 못 보여주지만, 만진 파일은 git 으로 잡고 작업 리포트 카드도 동일하게 나옵니다."},
                      {note: "각 CLI 는 세션 기록을 **자기 영역**(예: `~/.claude`, `~/.codex`)에 쌓고 시간이 지날수록 커집니다. loom 은 자신이 만든 세션을 추적하므로 **대화를 삭제하면** 그 대화의 CLI 세션 파일도 함께 정리합니다(**연결** 탭에서 CLI별 용량 확인)."},
                  ]
                : [
                      {p: "Each CLI uses its own auth (BYOK); loom absorbs the differences via adapters and surfaces capability gaps honestly."},
                      {table: {head: ["CLI", "Tool steps", "MCP injection", "Delegation"], rows: [
                          ["claude-code", "✅ JSON stream", "✅ `--mcp-config`", "✅ MCP tool"],
                          ["codex", "✅ JSON stream", "✅ `-c mcp_servers`", "✅ MCP tool"],
                          ["opencode", "✅ JSON stream", "✅ XDG redirect", "✅ MCP tool"],
                          ["antigravity", "⚠️ plain text", "❌ (CLI limit)", "✅ shell bridge"],
                          ["devin", "⚠️ plain text", "✅ project-local file", "✅"],
                      ]}},
                      {note: "Plain-text CLIs can't show tool calls live, but their touched files are captured via git and the work-report card still appears."},
                      {note: "Each CLI piles up its session history in **its own root** (e.g. `~/.claude`, `~/.codex`), which grows over time. loom won't delete these (CLI root is off-limits) — check per-CLI sizes in the **Connections** tab and clear them yourself when needed."},
                  ],
        },
        {
            id: "governance",
            icon: <Wallet className="size-4" />,
            title: ko ? "예산 & 평가" : "Budget & ratings",
            blocks: ko
                ? [
                      {ul: [
                          "**예산** — `office/budget.json` 에 월 상한(USD, 전체 + 에이전트별). 사용량은 usage 에서 집계.",
                          "**평가** — run 마다 👍/👎. 30일 실적으로 에이전트의 성과를 봅니다.",
                          "**공유 메모** — `<프로젝트>/.loom/notes.md` 는 사람과 에이전트가 같이 보는 프로젝트 메모예요.",
                      ]},
                  ]
                : [
                      {ul: [
                          "**Budget** — `office/budget.json` holds monthly caps (USD, total + per-agent). Usage is aggregated in the usage view.",
                          "**Ratings** — 👍/👎 per run feeds a 30-day track record per agent.",
                          "**Shared notes** — `<project>/.loom/notes.md` is a project memo shared by humans and agents.",
                      ]},
                  ],
        },
    ];
}

export function GuidePage() {
    const {lang} = useI18n();
    const secs = sections(lang === "ko" ? "ko" : "en");
    const [active, setActive] = useState(secs[0]!.id);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 스크롤 위치로 좌측 점프 하이라이트.
    useEffect(() => {
        const root = scrollRef.current;
        if (!root) return;
        const onScroll = () => {
            const top = root.scrollTop;
            let current = secs[0]!.id;
            for (const s of secs) {
                const el = root.querySelector<HTMLElement>(`#guide-${s.id}`);
                if (el && el.offsetTop - 120 <= top) current = s.id;
            }
            setActive(current);
        };
        root.addEventListener("scroll", onScroll, {passive: true});
        onScroll();
        return () => root.removeEventListener("scroll", onScroll);
    }, [secs]);

    const jump = (id: string) => {
        const root = scrollRef.current;
        const el = root?.querySelector<HTMLElement>(`#guide-${id}`);
        if (root && el) root.scrollTo({top: el.offsetTop - 24, behavior: "smooth"});
    };

    return (
        <div className="flex h-full min-h-0">
            {/* 좌측 섹션 점프 */}
            <nav className="hidden w-60 shrink-0 overflow-y-auto border-r border-border/30 p-4 md:block">
                <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold text-foreground">
                    <BookOpen className="size-4 text-primary" />
                    {lang === "ko" ? "사용 설명서" : "User guide"}
                </div>
                <ul className="space-y-0.5">
                    {secs.map((s) => (
                        <li key={s.id}>
                            <button
                                type="button"
                                onClick={() => jump(s.id)}
                                className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-all",
                                    active === s.id
                                        ? "bg-primary/15 font-medium text-foreground shadow-[var(--shadow-glow-sm)]"
                                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                )}
                            >
                                <span className={active === s.id ? "text-primary" : ""}>{s.icon}</span>
                                {s.title}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            {/* 본문 */}
            <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10">
                <div className="mx-auto max-w-3xl">
                    <h1 className="font-display text-2xl font-semibold text-foreground">
                        {lang === "ko" ? "loom 사용 설명서" : "loom user guide"}
                    </h1>
                    <p className="mt-1 mb-2 text-sm text-muted-foreground">
                        {lang === "ko"
                            ? "여러 CLI 에이전트를 한 오피스에서 같이 부리는 법 — 개념부터 디스패치·위임까지."
                            : "How to run many CLI agents from one office — concepts through dispatch & delegation."}
                    </p>

                    {secs.map((s) => (
                        <section key={s.id} id={`guide-${s.id}`} className="scroll-mt-6 border-t border-border/30 pt-7 mt-7 first:border-0 first:pt-3 first:mt-3">
                            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-foreground">
                                <span className="text-primary">{s.icon}</span>
                                {s.title}
                            </h2>
                            {s.blocks.map((b, i) => (
                                <BlockView key={i} block={b} />
                            ))}
                        </section>
                    ))}
                    <div className="h-16" />
                </div>
            </div>
        </div>
    );
}
