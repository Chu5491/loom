/**
 * Compatibility shim for our pre-shadcn primitives.
 *
 * The whole project is migrating to shadcn/ui (new component files live in
 * components/ui/*). This file preserves the older import surface that
 * AgentsPage / SpecsPage / RunsPage / etc. still use, mapping the legacy
 * prop names (`variant: "primary"|"danger"`, `tone: "neutral"|"warn"`)
 * onto the shadcn variants underneath. Once every page is migrated this
 * file can be deleted.
 */

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
