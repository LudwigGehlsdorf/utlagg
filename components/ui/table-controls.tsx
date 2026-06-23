"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { IconSearch, IconChevronLeft, IconChevronRight } from "./icons";
import { DateInput } from "./date-input";

const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type SortDir = "asc" | "desc";

export type TableControlState = {
  query: string;
  setQuery: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  pageSize: PageSize;
  setPageSize: (n: PageSize) => void;
  page: number;
  setPage: (n: number) => void;
  paginate: <T>(items: T[]) => T[];
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
};

export function useTableControls(): TableControlState {
  const [query, setQueryRaw] = useState("");
  const [dateFrom, setDateFromRaw] = useState("");
  const [dateTo, setDateToRaw] = useState("");
  const [pageSize, setPageSizeRaw] = useState<PageSize>(25);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const reset = () => setPage(0);
  const setQuery = (v: string) => { setQueryRaw(v); reset(); };
  const setDateFrom = (v: string) => { setDateFromRaw(v); reset(); };
  const setDateTo = (v: string) => { setDateToRaw(v); reset(); };
  const setPageSize = (n: PageSize) => { setPageSizeRaw(n); reset(); };
  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    reset();
  };

  const paginate = <T,>(items: T[]): T[] =>
    items.slice(page * pageSize, (page + 1) * pageSize);

  return { query, setQuery, dateFrom, setDateFrom, dateTo, setDateTo, pageSize, setPageSize, page, setPage, paginate, sortKey, sortDir, toggleSort };
}

// Sortable table header cell. Renders a <th> with a sort indicator.
export function SortableHeader({
  children,
  sortKey: key,
  controls,
  className,
}: {
  children: React.ReactNode;
  sortKey: string;
  controls: Pick<TableControlState, "sortKey" | "sortDir" | "toggleSort">;
  className?: string;
}) {
  const active = controls.sortKey === key;
  return (
    <th
      onClick={() => controls.toggleSort(key)}
      className={cn("cursor-pointer select-none whitespace-nowrap", className)}
    >
      {children}
      <span className={cn("ml-1 text-[10px]", active ? "text-accent" : "text-transparent")}>
        {controls.sortDir === "asc" ? "▲" : "▼"}
      </span>
    </th>
  );
}

// Filter bar — place between a CardHeader and the list. Pass domain-specific
// filter controls (e.g. a status select) via children.
export function FilterBar({
  query,
  onQueryChange,
  searchPlaceholder = "Sök transaktion…",
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  children,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  searchPlaceholder?: string;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  children?: React.ReactNode;
}) {
  const input =
    "h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      {/* Text search */}
      <div className="relative min-w-48 flex-1">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className={cn(input, "pl-8")}
        />
      </div>

      {/* Date range */}
      <DateInput
        value={dateFrom}
        onChange={(e) => onDateFromChange(e.target.value)}
        title="Från datum"
        className={cn(input, "w-40")}
      />
      <span className="text-xs text-muted">–</span>
      <DateInput
        value={dateTo}
        onChange={(e) => onDateToChange(e.target.value)}
        title="Till datum"
        className={cn(input, "w-40")}
      />

      {/* Extra domain-specific filters */}
      {children}
    </div>
  );
}

// Pagination footer — place after the list.
export function Pagination({
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  totalItems,
}: {
  page: number;
  onPageChange: (n: number) => void;
  pageSize: PageSize;
  onPageSizeChange: (n: PageSize) => void;
  totalItems: number;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalItems);

  const select =
    "h-8 rounded-lg border border-border bg-background px-2 text-sm focus:border-accent focus:outline-none";
  const btn =
    "flex size-8 items-center justify-center rounded-lg border border-border bg-background text-sm transition-colors hover:bg-surface disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-3">
      <p className="text-xs text-muted">
        {totalItems === 0
          ? "Inga resultat"
          : `Visar ${from}–${to} av ${totalItems}`}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Visa
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            className={select}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          per sida
        </label>
        <button
          className={btn}
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Föregående sida"
        >
          <IconChevronLeft className="size-4" />
        </button>
        <button
          className={btn}
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Nästa sida"
        >
          <IconChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
