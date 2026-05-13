import { DiffEditor } from "@monaco-editor/react";
import { useTheme } from "../context/ThemeContext.js";

export function MonacoDiff({
  before,
  after,
  path,
  wrap,
}: {
  before: string;
  after: string;
  /** 파일 경로 — 확장자 기반 신택스 하이라이트에 사용. */
  path: string;
  wrap: boolean;
}) {
  const { effective } = useTheme();
  return (
    <DiffEditor
      height="100%"
      original={before}
      modified={after}
      originalLanguage={undefined}
      modifiedLanguage={undefined}
      // path 만 줘도 monaco 가 확장자로 언어를 추론.
      originalModelPath={`before:${path}`}
      modifiedModelPath={path}
      theme={effective === "dark" ? "vs-dark" : "vs"}
      options={{
        readOnly: true,
        // split-view 가 핵심. inline 모드 비활성.
        renderSideBySide: true,
        wordWrap: wrap ? "on" : "off",
        fontSize: 12,
        fontFamily:
          '"CommitMonoChu", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, monospace',
        // 좁은 폭에선 minimap 끔.
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        smoothScrolling: true,
        contextmenu: false,
        padding: { top: 8, bottom: 8 },
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
        // 양쪽 행을 가급적 정렬해서 readability ↑.
        renderOverviewRuler: false,
        ignoreTrimWhitespace: false,
        diffWordWrap: wrap ? "on" : "off",
      }}
    />
  );
}
