import { DiffEditor } from "@monaco-editor/react";
import { useTheme } from "../../context/ThemeContext.js";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  toml: "ini",
  xml: "xml",
  svg: "xml",
};

function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return EXT_TO_LANG[path.slice(dot + 1).toLowerCase()] ?? "plaintext";
}

export function MonacoDiff({
  original,
  modified,
  path,
  wrap = false,
}: {
  original: string;
  modified: string;
  path: string;
  wrap?: boolean;
}) {
  const { effective } = useTheme();
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={langFromPath(path)}
      theme={effective === "dark" ? "vs-dark" : "vs"}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 12,
        lineHeight: 18,
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        wordWrap: wrap ? "on" : "off",
        diffWordWrap: wrap ? "on" : "off",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
