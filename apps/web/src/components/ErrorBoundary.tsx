// 렌더 오류 격리 — 한 컴포넌트가 던져도 화면 전체가 백지가 되지 않게.
// 클래스 컴포넌트(getDerivedStateFromError 가 클래스 전용). 라벨은 호출부가 t() 로 전달.

import { Component, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

interface Props {
  children: ReactNode;
  /** 폴백 헤더에 보일 영역 이름 (호출부에서 i18n 처리). */
  label: string;
  retryLabel: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <TriangleAlert className="size-4" />
            {this.props.label}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
