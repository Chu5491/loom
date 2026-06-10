// 마크다운 렌더러 — LLM 응답·spec 문서를 보기 좋게.
// react-markdown(+remark-gfm)을 쓰는 이유: 기본적으로 raw HTML 을 실행하지 않아
// LLM 출력(신뢰 불가)에도 안전. 스타일은 styles.css 의 `.md` 스코프.

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils.js";

// 링크는 새 탭 + noopener(피싱/탭내빙 방지).
const components: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
