// Monaco 기반 read-only 코드 뷰어.
// 멀티 에이전트 presence — 같은 파일에 떠있는 모든 에이전트를 동시에 표시.
// 각 presence는 라인 배경 틴트 + 거터 컬러 바 + 미니맵 마커 + 라인 끝 @name 라벨.
// 라벨은 Monaco IContentWidget으로 박혀 인라인 스타일로 직접 색을 가져 18색 모두 지원.

import { useCallback, useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";
import { useTheme } from "../context/ThemeContext.js";
import type { AgentColor } from "./agentColor.js";

type StandaloneEditor = MonacoNS.editor.IStandaloneCodeEditor;
type MonacoApi = typeof MonacoNS;

export interface AgentPresence {
  agentId: string;
  agentName: string;
  color: AgentColor;
  line: number;
  /** primary는 가장 최근 활동 — 화면 밖이면 자동 점프. 한 번에 하나만. */
  primary?: boolean;
}

const COLOR_HEX: Record<AgentColor, string> = {
  sky: "#0ea5e9",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  fuchsia: "#d946ef",
  lime: "#84cc16",
  orange: "#f97316",
  cyan: "#06b6d4",
  indigo: "#6366f1",
  slate: "#64748b",
};

export function MonacoView({
  text,
  path,
  wrap,
  presences,
}: {
  text: string;
  path: string;
  wrap: boolean;
  presences?: AgentPresence[];
}) {
  const { effective } = useTheme();
  const editorRef = useRef<StandaloneEditor | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const widgetsRef = useRef<Set<string>>(new Set());

  const apply = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const list = presences ?? [];

    // 1) 라인 데코 — 배경 + 거터 + 미니맵 마커
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      list.map((p) => ({
        range: new monaco.Range(p.line, 1, p.line, 1),
        options: {
          isWholeLine: true,
          className: `loom-pres-${p.color}`,
          linesDecorationsClassName: `loom-pres-mk-${p.color}`,
          overviewRuler: {
            color: COLOR_HEX[p.color],
            position: monaco.editor.OverviewRulerLane.Right,
          },
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );

    // 2) 라인 끝 @name 라벨 — IContentWidget로 직접 DOM 삽입
    const wantedIds = new Set(list.map((p) => `loom-pres:${p.agentId}`));
    // 사라진 위젯 정리
    for (const id of widgetsRef.current) {
      if (!wantedIds.has(id)) {
        editor.removeContentWidget({
          getId: () => id,
          getDomNode: () => document.createElement("span"),
          getPosition: () => null,
        });
        widgetsRef.current.delete(id);
      }
    }
    for (const p of list) {
      const id = `loom-pres:${p.agentId}`;
      const dom = document.createElement("span");
      dom.className = "loom-pres-label";
      dom.style.color = COLOR_HEX[p.color];
      dom.style.background =
        effective === "dark"
          ? `rgba(${hexToRgb(COLOR_HEX[p.color])}, 0.18)`
          : `rgba(${hexToRgb(COLOR_HEX[p.color])}, 0.12)`;
      dom.textContent = `@${p.agentName}`;
      const widget: MonacoNS.editor.IContentWidget = {
        getId: () => id,
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber: p.line, column: Number.MAX_SAFE_INTEGER },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.EXACT,
          ],
        }),
      };
      // 동일 ID로 다시 add하면 Monaco가 알아서 교체 처리.
      editor.addContentWidget(widget);
      widgetsRef.current.add(id);
    }

    // 3) primary가 있으면 화면 밖일 때 부드럽게 가운데로
    const primary = list.find((p) => p.primary);
    if (primary) {
      editor.revealLineInCenterIfOutsideViewport(
        primary.line,
        monaco.editor.ScrollType.Smooth,
      );
    }
  }, [presences, effective]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    apply();
  };

  useEffect(() => {
    apply();
  }, [apply]);

  return (
    <Editor
      height="100%"
      path={path}
      value={text}
      theme={effective === "dark" ? "vs-dark" : "vs"}
      options={{
        readOnly: true,
        wordWrap: wrap ? "on" : "off",
        fontSize: 12,
        // 서비스 전체 단일 폰트. styles.css 의 @font-face 가 로드되면
        // Monaco도 같은 글꼴로 그려짐. 시스템 mono를 fallback으로 둬서
        // 폰트 다운로드 전 잠깐의 FOUT를 안전하게 처리.
        fontFamily:
          '"CommitMonoChu", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, monospace',
        minimap: { enabled: true, renderCharacters: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        smoothScrolling: true,
        cursorBlinking: "solid",
        contextmenu: false,
        padding: { top: 8, bottom: 8 },
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
      onMount={onMount}
      loading={
        <div className="px-5 py-4 text-sm text-muted-foreground">…</div>
      }
    />
  );
}

function hexToRgb(hex: string): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
