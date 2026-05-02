// shiki 하이라이터 싱글톤. 첫 호출에서만 동적 import → 메인 번들 격리.

import type { Highlighter, BundledLanguage, BundledTheme } from "shiki";

const LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "bash",
  "shell",
  "json",
  "html",
  "css",
  "go",
  "rust",
  "sql",
  "yaml",
  "markdown",
  "diff",
] as const satisfies readonly BundledLanguage[];

const THEMES = ["github-dark", "github-light"] as const satisfies readonly BundledTheme[];

let promise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  promise ??= import("shiki").then(({ createHighlighter }) =>
    createHighlighter({ langs: [...LANGS], themes: [...THEMES] }),
  );
  return promise;
}

export function isSupportedLang(lang: string): lang is (typeof LANGS)[number] {
  return (LANGS as readonly string[]).includes(lang);
}
