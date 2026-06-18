// loom 전용 UI 프리미티브.
// shadcn/ui 위에 프로젝트 어휘(variant: primary/danger, tone: neutral/warn)를
// 통일하고, Field·Card(padding 기본 포함) 같은 조합 컴포넌트를 제공.

import * as React from "react";
import { motion } from "framer-motion";
import { Button as ShadcnButton, type ButtonProps as ShadcnButtonProps } from "./ui/button.js";
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
    <motion.section
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card/60 backdrop-blur-xl relative overflow-hidden",
        glow ? "border-primary/50 shadow-[var(--shadow-glow)]" : "border-border/40",
        className,
      )}
    >
      {/* Background cyber accent line */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-cyber opacity-30" />
      {title ? (
        <header className="flex items-center gap-2 border-b border-border/40 px-5 py-3 sm:px-6 relative z-10">
          {icon ? <span className="flex shrink-0 items-center text-primary [&>svg]:size-4 drop-shadow-[0_0_8px_color-mix(in_oklch,var(--primary)_50%,transparent)]">{icon}</span> : null}
          <h3 className="truncate text-[13px] font-semibold uppercase tracking-wider text-primary/80">{title}</h3>
          {count !== undefined ? (
            <motion.span 
              key={count} 
              initial={{ scale: 0.5, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              className="rounded-full bg-primary/20 px-2 text-[11px] tabular-nums text-primary shadow-[var(--shadow-glow-sm)]"
            >
              {count}
            </motion.span>
          ) : null}
          {actions ? <span className="ml-auto flex items-center gap-1.5">{actions}</span> : null}
        </header>
      ) : null}
      {/* noPad=IDE 컨텐츠. 자식이 flex-1 로 풀하이트 가져갈 수 있게 flex flex-col. */}
      <div className={cn(
        "relative z-10 flex min-h-0 flex-1 flex-col",
        noPad ? "" : "p-5 sm:p-6",
      )}>{children}</div>
    </motion.section>
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
        tone === "busy" && "bg-primary shadow-[0_0_8px_color-mix(in_oklch,var(--primary)_80%,transparent)]",
        tone === "idle" && "bg-muted-foreground/30",
        tone === "ok" && "bg-success shadow-[0_0_8px_color-mix(in_oklch,var(--success)_60%,transparent)]",
        tone === "bad" && "bg-destructive",
        (pulse ?? tone === "busy") && "animate-pulse",
        className,
      )}
    />
  );
}

// ─── PageShell — 미션 컨트롤 풀하이트 셸. 상단 컨텍스트 바(슬림) + 본문(내부 스크롤).
// 페이지 본문은 자체 스크롤만 가짐 — 페이지 전역 스크롤 차단. (Talk 와 동일한 리듬.)
export function PageShell({
  title,
  subtitle,
  actions,
  children,
  className,
  /** 본문에 자동 overflow-y-auto 를 줄지. 기본 true. IDE 그리드를 직접 짤 땐 false. */
  scrollable = true,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
}) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "flex h-full w-full flex-col p-4 sm:p-6 lg:p-8",
        className,
      )}
    >
      {/* 컨텍스트 바 — 한 줄 슬림(36px). 큰 타이틀 블록 제거. */}
      <header className="flex shrink-0 items-center gap-3 py-2">
        <h1 className="font-display text-[13px] font-semibold tracking-tight text-primary/90">
          {title}
        </h1>
        {subtitle ? (
          <p className="hidden min-w-0 truncate text-xs text-muted-foreground/70 lg:block">{subtitle}</p>
        ) : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      {/* 본문 — flex 컨테이너로 자식이 flex-1 풀하이트 받음. */}
      <div className={cn("flex min-h-0 flex-1 flex-col pb-3 pt-2", scrollable && "overflow-y-auto")}>
        {children}
      </div>
    </motion.main>
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
