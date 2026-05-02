// 프로미스 기반 confirm — `const ok = await confirm({title, ...})`로 호출.
// Radix AlertDialog 위에 motion AnimatePresence를 얹어 enter/exit 부드럽게.

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "./ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

interface ConfirmInput {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Resolver = (ok: boolean) => void;

const ConfirmContext = createContext<((input: ConfirmInput) => Promise<boolean>) | null>(
  null,
);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<{
    input: ConfirmInput;
    resolve: Resolver;
  } | null>(null);

  const confirm = useCallback(
    (input: ConfirmInput) =>
      new Promise<boolean>((resolve) => setState({ input, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root
        open={!!state}
        onOpenChange={(v) => {
          if (!v && state) close(false);
        }}
      >
        <AnimatePresence>
          {state ? (
            <AlertDialog.Portal forceMount>
              <AlertDialog.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
                />
              </AlertDialog.Overlay>
              <AlertDialog.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 8 }}
                  transition={{ duration: 0.16 }}
                  className="fixed left-1/2 top-1/2 z-50 w-[min(420px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-5 shadow-2xl outline-none"
                >
                  <AlertDialog.Title className="text-base font-semibold">
                    {state.input.title}
                  </AlertDialog.Title>
                  {state.input.description ? (
                    <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                      {state.input.description}
                    </AlertDialog.Description>
                  ) : null}
                  <div className="mt-5 flex justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button variant="ghost" size="sm" onClick={() => close(false)}>
                        {state.input.cancelLabel ?? t("common.cancel")}
                      </Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <Button
                        size="sm"
                        onClick={() => close(true)}
                        className={cn(
                          state.input.destructive &&
                            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                        )}
                      >
                        {state.input.confirmLabel ??
                          (state.input.destructive
                            ? t("common.delete")
                            : t("common.create"))}
                      </Button>
                    </AlertDialog.Action>
                  </div>
                </motion.div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          ) : null}
        </AnimatePresence>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
