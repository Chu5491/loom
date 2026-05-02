// 에이전트 응답 마크다운 렌더 + shiki 코드 블록 신택스 하이라이트.
// CLI 출력은 로컬 신뢰 — 호스팅 시 DOMPurify 추가 필요.
//
// 패턴: marked로 동기 렌더 후, useEffect에서 shiki가 준비되면 코드 블록만 교체.
// 첫 페인트가 빠르고, 하이라이터 로드(첫 호출 ~80ms)는 백그라운드.

import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import { getHighlighter, isSupportedLang } from "../../lib/codeHighlighter.js";
import { useTheme } from "../../context/ThemeContext.js";

marked.setOptions({ breaks: true, gfm: true });

export function MarkdownView({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { effective } = useTheme();
  const html = useMemo(() => marked.parse(text) as string, [text]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const codes = root.querySelectorAll("pre > code");
    if (codes.length === 0) return;

    let cancelled = false;
    const theme = effective === "dark" ? "github-dark" : "github-light";

    void getHighlighter().then((hl) => {
      if (cancelled) return;
      codes.forEach((node) => {
        const code = node.textContent ?? "";
        const langClass = Array.from(node.classList).find((c) =>
          c.startsWith("language-"),
        );
        const rawLang = langClass?.slice("language-".length) ?? "text";
        const lang = isSupportedLang(rawLang) ? rawLang : "text";
        try {
          const highlighted = hl.codeToHtml(code, { lang, theme });
          const pre = node.parentElement;
          if (pre) pre.outerHTML = highlighted;
        } catch {
          // 지원되지 않는 언어 — 평문 유지
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [html, effective]);

  return (
    <div
      ref={ref}
      className="prose-loom max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
