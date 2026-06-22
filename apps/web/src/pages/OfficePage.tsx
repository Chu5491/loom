// Office 화면 — IDE 스타일. 좌측 트리(검색 + 그룹) + 우측 디테일 편집기.
// office/ 파일이 진실의 원천. 여긴 그 뷰 + 안전한 편집기.
//
// 트리는 6개 그룹(Agents/Rules/Skills/MCP/Workflows/Prompts)을 한눈에 보여주고,
// 각 항목 옆에 "쓰는 에이전트 N" 같은 크로스레퍼런스를 표시한다. 검색은 모든 그룹에
// 적용된다. 편집은 우측 패널에서 — 항목을 바꾸면 패널이 그 항목으로 스왑된다.
//
// 셸(트리 상태 + 레이아웃)만 여기 남고, 트리·디테일·편집기·공용 폼은
// components/office/* 로 분리. 공유 타입/상수/헬퍼/훅은 shared.ts·guards.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api } from "../api/client.js";
import { PageShell, Panel } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { useConfirm } from "../context/DialogContext.js";
import { OfficeTree } from "../components/office/Tree.js";
import { DetailView } from "../components/office/editors.js";
import type { Kind, Selection } from "../components/office/shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────────

export function OfficePage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const data = office.data?.office;
  const [selection, setSelection] = useState<Selection>({ kind: "overview" });
  // 미저장 draft 가드 — 활성 디테일이 dirty 체크 함수를 등록하고, 트리에서 다른
  // 항목으로 전환할 때 확인을 거친다(디테일은 전부 로컬 draft 라 전환 = 소실).
  const dirtyCheck = useRef<() => boolean>(() => false);
  const registerDirty = useCallback((fn: () => boolean) => {
    dirtyCheck.current = fn;
  }, []);
  const guardedSelect = useCallback(
    async (s: Selection) => {
      if (dirtyCheck.current() && !(await confirm(t("office.unsavedConfirm")))) return;
      dirtyCheck.current = () => false;
      setSelection(s);
    },
    [t],
  );
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyCheck.current()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<Kind, boolean>>({
    agent: true,
    rule: true,
    skill: true,
    mcp: true,
    workflow: true,
    function: true,
    prompt: true,
  });
  const toggleGroup = (k: Kind) => setExpanded((s) => ({ ...s, [k]: !s[k] }));
  // 사이드바 열기/닫기 — 디테일에 집중하고 싶을 때. localStorage 영속.
  const [treeOpen, setTreeOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("loom.office.tree") !== "0";
  });
  const toggleTree = () => {
    setTreeOpen((v) => {
      const next = !v;
      try { window.localStorage.setItem("loom.office.tree", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // 사이드바 너비 — 드래그로 조절(200~480), localStorage 영속.
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 320;
    const v = parseInt(window.localStorage.getItem("loom.office.tree.w") ?? "", 10);
    return Number.isFinite(v) ? Math.max(220, Math.min(480, v)) : 320;
  });
  const widthRef = useRef(treeWidth);
  widthRef.current = treeWidth;
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(220, Math.min(480, startW + (ev.clientX - startX)));
      setTreeWidth(next);
    };
    const onUp = () => {
      try { window.localStorage.setItem("loom.office.tree.w", String(widthRef.current)); } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <PageShell
      title={t("office.title")}
      subtitle={t("office.subtitle")}
      scrollable={false}
      actions={
        <button
          type="button"
          onClick={toggleTree}
          aria-label={treeOpen ? t("office.tree.close") : t("office.tree.open")}
          title={treeOpen ? t("office.tree.close") : t("office.tree.open")}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          {treeOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          <span className="hidden sm:inline">{treeOpen ? t("office.tree.close") : t("office.tree.open")}</span>
        </button>
      }
    >
      {/* IDE 풀하이트 — 3컬럼(트리 / 핸들 / 디테일). 핸들 컬럼이 시각적 간격. */}
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: treeOpen ? `${treeWidth}px 12px 1fr` : "0px 0px 1fr",
        }}
      >
        {data && treeOpen ? (
          <OfficeTree
            office={data}
            selection={selection}
            onSelect={guardedSelect}
            search={search}
            setSearch={setSearch}
            expanded={expanded}
            toggleGroup={toggleGroup}
          />
        ) : (
          <aside className="overflow-hidden" />
        )}
        {/* 드래그 핸들 — 12px 폭 그립 영역, 1px 라인 중앙 + 호버 강조 */}
        {treeOpen ? (
          <div
            onMouseDown={startResize}
            className="group hidden cursor-col-resize items-stretch justify-center lg:flex"
            aria-label={t("office.tree.resize")}
            title={t("office.tree.resize")}
          >
            <span className="w-px self-stretch bg-border/40 transition-colors group-hover:bg-primary/60" />
          </div>
        ) : (
          <div />
        )}
        <Panel className="min-h-0" noPad>
          {!data ? (
            <p className="p-6 text-sm text-muted-foreground">{t("common.checking")}</p>
          ) : (
            <DetailView office={data} selection={selection} onSelect={setSelection} registerDirty={registerDirty} />
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
