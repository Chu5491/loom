// loom 전용 UI 프리미티브.
// shadcn/ui 위에 프로젝트 어휘(variant: primary/danger, tone: neutral/warn)를
// 통일하고, Field·Card(padding 기본 포함) 같은 조합 컴포넌트를 제공.

import * as React from "react";
import { Button as ShadcnButton, type ButtonProps as ShadcnButtonProps } from "./ui/button.js";
import { Input as ShadcnInput } from "./ui/input.js";
import { Textarea as ShadcnTextarea } from "./ui/textarea.js";
import { Label as ShadcnLabel } from "./ui/label.js";
import { Card as ShadcnCard } from "./ui/card.js";
import { Badge as ShadcnBadge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";

// ─── Button ────────────────────────────────────────────────────────────────
type LegacyButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type LegacyButtonSize = "sm" | "md";

const VARIANT_MAP: Record<LegacyButtonVariant, ShadcnButtonProps["variant"]> = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
};

const SIZE_MAP: Record<LegacyButtonSize, ShadcnButtonProps["size"]> = {
  sm: "sm",
  md: "default",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  Omit<ShadcnButtonProps, "variant" | "size"> & {
    variant?: LegacyButtonVariant;
    size?: LegacyButtonSize;
  }
>(({ variant = "primary", size = "md", ...props }, ref) => (
  <ShadcnButton
    ref={ref}
    variant={VARIANT_MAP[variant]}
    size={SIZE_MAP[size]}
    {...props}
  />
));
Button.displayName = "Button";

// ─── Form primitives (pass-through) ────────────────────────────────────────
export const Input = ShadcnInput;
export const Textarea = ShadcnTextarea;

// ─── Label (loom uses tiny uppercase labels above inputs) ─────────────────
export function Label({
  className,
  ...rest
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <ShadcnLabel
      className={cn("text-xs uppercase tracking-wide text-muted-foreground", className)}
      {...rest}
    />
  );
}

// ─── Card (legacy: padded by default; opt out with `noPad`) ───────────────
export function Card({
  className,
  noPad,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { noPad?: boolean }) {
  return (
    <ShadcnCard
      className={cn(noPad ? "" : "p-4", className)}
      {...rest}
    />
  );
}

// ─── Badge (legacy `tone` → shadcn `variant`) ─────────────────────────────
type LegacyBadgeTone = "neutral" | "success" | "danger" | "warn" | "info";
const TONE_MAP: Record<
  LegacyBadgeTone,
  "secondary" | "success" | "destructive" | "warning" | "info"
> = {
  neutral: "secondary",
  success: "success",
  danger: "destructive",
  warn: "warning",
  info: "info",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: LegacyBadgeTone;
  className?: string;
}) {
  return (
    <ShadcnBadge variant={TONE_MAP[tone]} className={className}>
      {children}
    </ShadcnBadge>
  );
}

// ─── Panel — 관제센터·페이지 공통 모듈. 헤더(아이콘+제목+카운트+액션) + 본문.
// 모든 화면이 같은 패널 문법을 쓰는 것이 "납땜 느낌" 제거의 핵심.
export function Panel({
  icon,
  title,
  count,
  actions,
  glow,
  noPad,
  className,
  children,
}: {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  count?: number | string;
  actions?: React.ReactNode;
  /** 살아있는(라이브) 패널 강조 — primary 보더 + 글로우. */
  glow?: boolean;
  noPad?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card",
        glow ? "border-primary/30 shadow-[var(--shadow-glow-sm)]" : "border-border",
        className,
      )}
    >
      {title ? (
        <header className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2.5">
          {icon ? <span className="flex shrink-0 items-center text-primary [&>svg]:size-3.5">{icon}</span> : null}
          <h3 className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
          {count !== undefined ? (
            <span className="rounded-full bg-muted/60 px-1.5 text-[10px] tabular-nums text-muted-foreground">{count}</span>
          ) : null}
          {actions ? <span className="ml-auto flex items-center gap-1.5">{actions}</span> : null}
        </header>
      ) : null}
      <div className={cn("min-h-0 flex-1", noPad ? "" : "p-4")}>{children}</div>
    </section>
  );
}

// ─── StatusDot — 에이전트/run 상태 점 (작업중=펄스 primary).
export function StatusDot({
  tone = "idle",
  pulse,
  className,
}: {
  tone?: "busy" | "idle" | "ok" | "bad";
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        tone === "busy" && "bg-primary",
        tone === "idle" && "bg-muted-foreground/30",
        tone === "ok" && "bg-success",
        tone === "bad" && "bg-destructive",
        (pulse ?? tone === "busy") && "animate-pulse",
        className,
      )}
    />
  );
}

// ─── PageShell — 화면 공통 골격. 제목 리듬·여백·최대폭을 한 곳에서.
export function PageShell({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("mx-auto max-w-6xl px-4 py-6 sm:px-6", className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </main>
  );
}

// ─── Field (label + control + hint) ────────────────────────────────────────
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
