// 공용 확인 모달 — 브라우저 confirm() 대체. Esc/배경 클릭 = 취소, 확인 버튼 autoFocus.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export function ConfirmDialog({
  icon,
  title,
  body,
  confirmLabel,
  tone = "default",
  onConfirm,
  onCancel,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          {icon ? (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl border",
                tone === "danger"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-primary/30 bg-primary/10 text-primary",
              )}
            >
              {icon}
            </span>
          ) : null}
          <h2 className="font-display text-base font-semibold">{title}</h2>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} size="sm" autoFocus onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
