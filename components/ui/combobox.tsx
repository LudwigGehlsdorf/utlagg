"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { IconCheck, IconChevronDown } from "./icons";

export interface ComboOption {
  value: string;
  label: string;
}

// A strict, searchable single-select. You can filter by typing, but only a value
// that exists in `options` (or "" when `allowClear`) can be committed. The menu
// renders in a portal with fixed positioning so it never gets clipped by an
// overflow/scroll ancestor (e.g. a table). Styled to match the app's fields.
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Välj…",
  searchPlaceholder = "Sök…",
  emptyText = "Inga träffar",
  allowClear = false,
  clearLabel = "Rensa",
  disabled,
  className,
  buttonClassName,
  invalid,
  "aria-label": ariaLabel,
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string; // replaces the default field appearance when given
  invalid?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  function openMenu(initial = "") {
    if (disabled) return;
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setQuery(initial);
    setActive(initial ? 0 : Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function close() { setOpen(false); }
  function commit(v: string) { onChange(v); close(); triggerRef.current?.focus(); }

  // Fixed-position menu, flipped up / clamped so it never spills off-screen.
  function menuStyle(): React.CSSProperties {
    if (!rect) return {};
    const width = Math.max(rect.width, 240);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom;
    const dropUp = below < 300 && rect.top > below;
    return dropUp
      ? { position: "fixed", bottom: window.innerHeight - rect.top + 4, left, width }
      : { position: "fixed", top: rect.bottom + 4, left, width };
  }

  // Focus the search when opening; close on outside click, scroll, resize.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    // Close when an ancestor/page scrolls (the fixed menu would be misplaced),
    // but NOT when scrolling inside the menu's own option list.
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) close(); };
    const onResize = () => close();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) commit(o.value); }
    else if (e.key === "Escape") { e.preventDefault(); close(); triggerRef.current?.focus(); }
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            // Type-to-open: start the search with the first character.
            e.preventDefault();
            openMenu(e.key);
          }
        }}
        className={cn(
          "flex w-full items-center justify-between gap-1.5 text-left text-sm outline-none disabled:opacity-50",
          buttonClassName ?? "h-9 rounded-lg border border-border bg-background px-2.5 focus:border-accent",
          invalid && "text-danger",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted/60")}>
          {selected ? selected.label : placeholder}
        </span>
        <IconChevronDown className="size-4 shrink-0 text-muted/60" />
      </button>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={menuStyle()}
          className="z-50 overflow-hidden rounded-xl border border-border bg-background shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onSearchKey}
              placeholder={searchPlaceholder}
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto p-1">
            {allowClear && selected && (
              <li>
                <button
                  type="button"
                  onClick={() => commit("")}
                  className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-muted hover:bg-surface"
                >
                  {clearLabel}
                </button>
              </li>
            )}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">{emptyText}</li>
            )}
            {filtered.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                    i === active ? "bg-surface" : "hover:bg-surface",
                    o.value === value && "font-medium text-accent",
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <IconCheck className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
