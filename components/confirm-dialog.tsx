"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconAlert } from "@/components/ui/icons";

// One reusable confirmation dialog for every destructive / irreversible action,
// replacing window.confirm() and ad-hoc inline confirm UI. Use via useConfirm():
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: "Ta bort?", message: "…", tone: "danger" }))) return;

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      setPending((cur) => {
        cur?.resolve(ok);
        return null;
      });
    },
    [],
  );

  // Esc cancels, Enter confirms.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
      if (e.key === "Enter") settle(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, settle]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-[var(--shadow-card)]"
          >
            <div className="flex gap-3">
              {pending.tone === "danger" && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                  <IconAlert className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">{pending.title}</h2>
                {pending.message && (
                  <p className="mt-1 text-sm text-muted">{pending.message}</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <Button variant="secondary" size="sm" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Avbryt"}
              </Button>
              <Button
                autoFocus
                variant={pending.tone === "danger" ? "danger" : "primary"}
                size="sm"
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Bekräfta"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
