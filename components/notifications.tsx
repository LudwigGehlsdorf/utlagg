"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { IconAlert, IconCheck, IconInfo, IconX } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// One unified way to surface every transient message in the app: a stack of
// dismissible banners at the top of the page content. Errors persist until
// dismissed; success/info auto-dismiss after a few seconds. Use via useNotify().

export type NotifyTone = "error" | "success" | "info";

export interface Notification {
  id: string;
  tone: NotifyTone;
  title?: string;
  message: string;
}

interface NotifyApi {
  error: (message: string, title?: string) => string;
  success: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const AUTO_DISMISS_MS: Record<NotifyTone, number | null> = {
  // Errors stay until the user dismisses them; positive/neutral messages fade.
  error: null,
  success: 5000,
  info: 6000,
};

const Ctx = createContext<NotifyApi | null>(null);

// Separate context for the live list so the banner region re-renders on every
// notification while pages (which only consume the stable useNotify API) don't.
const ListCtx = createContext<{ items: Notification[]; dismiss: (id: string) => void } | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((cur) => cur.filter((n) => n.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: NotifyTone, message: string, title?: string) => {
      const id = crypto.randomUUID();
      setItems((cur) => [...cur, { id, tone, title, message }]);
      const ms = AUTO_DISMISS_MS[tone];
      if (ms != null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<NotifyApi>(
    () => ({
      error: (message, title) => push("error", message, title),
      success: (message, title) => push("success", message, title),
      info: (message, title) => push("info", message, title),
      dismiss,
      clear: () => setItems([]),
    }),
    [push, dismiss],
  );

  const listValue = useMemo(() => ({ items, dismiss }), [items, dismiss]);

  return (
    <Ctx.Provider value={api}>
      <ListCtx.Provider value={listValue}>{children}</ListCtx.Provider>
    </Ctx.Provider>
  );
}

export function useNotify(): NotifyApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotify must be used within NotificationsProvider");
  return ctx;
}

const TONE_STYLE: Record<NotifyTone, { wrap: string; icon: React.ReactNode }> = {
  error: {
    wrap: "border-danger/30 bg-danger-soft text-danger",
    icon: <IconAlert className="size-5 shrink-0" />,
  },
  success: {
    wrap: "border-success/30 bg-success-soft text-success",
    icon: <IconCheck className="size-5 shrink-0" />,
  },
  info: {
    wrap: "border-accent/30 bg-accent-soft text-accent",
    icon: <IconInfo className="size-5 shrink-0" />,
  },
};

export function NotificationBanners() {
  const list = useContext(ListCtx);
  if (!list || list.items.length === 0) return null;
  return (
    <div className="mb-5 space-y-2">
      {list.items.map((n) => {
        const t = TONE_STYLE[n.tone];
        return (
          <div
            key={n.id}
            role={n.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
              t.wrap,
            )}
          >
            {t.icon}
            <div className="min-w-0 flex-1 leading-snug">
              {n.title && <p className="font-semibold">{n.title}</p>}
              <p className={cn(n.title && "text-foreground/80")}>{n.message}</p>
            </div>
            <button
              type="button"
              onClick={() => list.dismiss(n.id)}
              aria-label="Stäng"
              className="-mr-1 -mt-0.5 rounded-md p-1 opacity-70 transition hover:opacity-100"
            >
              <IconX className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
