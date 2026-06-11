// Monaco 래퍼 — 파일 뷰어(CodeViewer)와 diff(CodeDiff). 앱 토큰과 어울리게
// 배경을 투명으로 깔고(컨테이너의 bg-card 가 비침) 미니맵 등 IDE 소음은 끈다.

import Editor, { DiffEditor, type Monaco } from "@monaco-editor/react";
import { useTheme } from "../context/ThemeContext.js";

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
  json: "json", md: "markdown", css: "css", html: "html", svg: "xml", xml: "xml",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  sh: "shell", bash: "shell", zsh: "shell", yml: "yaml", yaml: "yaml", toml: "ini",
  sql: "sql", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
};
export function langOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

function defineLoomTheme(monaco: Monaco) {
  monaco.editor.defineTheme("loom-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#00000000",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorGutter.background": "#00000000",
      "minimap.background": "#00000000",
      "diffEditor.insertedTextBackground": "#22c55e22",
      "diffEditor.removedTextBackground": "#ef444422",
      "diffEditor.insertedLineBackground": "#22c55e12",
      "diffEditor.removedLineBackground": "#ef444412",
    },
  });
  monaco.editor.defineTheme("loom-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: { "editor.background": "#00000000", "editorGutter.background": "#00000000" },
  });
}

const OPTS = {
  readOnly: true,
  minimap: { enabled: false },
  fontSize: 12.5,
  fontFamily: "CommitMonoChu, ui-monospace, monospace",
  scrollBeyondLastLine: false,
  padding: { top: 12, bottom: 12 },
  renderLineHighlight: "none" as const,
  overviewRulerLanes: 0,
  // 긴 줄은 자동 줄바꿈 — 가로 스크롤을 없앤다.
  wordWrap: "on" as const,
  scrollbar: { verticalScrollbarSize: 8, horizontal: "hidden" as const, horizontalScrollbarSize: 0 },
  automaticLayout: true,
};

export function CodeViewer({ path, value }: { path: string; value: string }) {
  const { effective } = useTheme();
  return (
    <Editor
      height="100%"
      language={langOf(path)}
      value={value}
      beforeMount={defineLoomTheme}
      theme={effective === "dark" ? "loom-dark" : "loom-light"}
      options={OPTS}
    />
  );
}

export function CodeDiff({ path, original, modified }: { path: string; original: string; modified: string }) {
  const { effective } = useTheme();
  return (
    <DiffEditor
      height="100%"
      language={langOf(path)}
      original={original}
      modified={modified}
      beforeMount={defineLoomTheme}
      theme={effective === "dark" ? "loom-dark" : "loom-light"}
      options={{
        ...OPTS,
        // 항상 전(좌)·후(우) 나란히 — 좁아도 인라인으로 안 바뀌게 고정.
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        hideUnchangedRegions: { enabled: true },
      }}
    />
  );
}
