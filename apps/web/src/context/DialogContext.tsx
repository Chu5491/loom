// 네이티브 confirm()/alert() 대체 — Promise 기반. 한 곳에서 ConfirmDialog 를 렌더하고
// useConfirm()/useAlert() 가 await 가능한 약속을 돌려준다(기존 동기 흐름을 최소 변경으로
// `if (!(await confirm(...))) return` 처럼 바꾼다).

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useI18n } from "./I18nContext.js";

export interface DialogOptions {
  title?: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface DialogState extends DialogOptions {
  mode: "confirm" | "alert";
  resolve: (ok: boolean) => void;
}

interface DialogApi {
  confirm: (opts: DialogOptions | string) => Promise<boolean>;
  alert: (opts: DialogOptions | string) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback(
    (opts: DialogOptions | string) =>
      new Promise<boolean>((resolve) =>
        setState({ ...(typeof opts === "string" ? { body: opts } : opts), mode: "confirm", resolve }),
      ),
    [],
  );
  const alert = useCallback(
    (opts: DialogOptions | string) =>
      new Promise<void>((resolve) =>
        setState({
          ...(typeof opts === "string" ? { body: opts } : opts),
          mode: "alert",
          resolve: () => resolve(),
        }),
      ),
    [],
  );

  const finish = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state ? (
        <ConfirmDialog
          title={state.title ?? (state.mode === "alert" ? t("common.notice") : t("common.confirmTitle"))}
          body={state.body}
          tone={state.tone}
          confirmLabel={state.confirmLabel ?? (state.mode === "alert" ? t("common.ok") : t("common.confirm"))}
          cancelLabel={state.cancelLabel}
          hideCancel={state.mode === "alert"}
          onConfirm={() => finish(true)}
          onCancel={() => finish(false)}
        />
      ) : null}
    </DialogContext.Provider>
  );
}

export function useConfirm(): DialogApi["confirm"] {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useConfirm must be used within DialogProvider");
  return api.confirm;
}

export function useAlert(): DialogApi["alert"] {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useAlert must be used within DialogProvider");
  return api.alert;
}
