"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { IconPlus } from "@/components/ui/icons";
import { SegmentedControl, type SegOption } from "@/components/ui/segmented-control";
import { useTableControls, FilterBar, Pagination, SortableHeader } from "@/components/ui/table-controls";
import { PAYMENT_META } from "@/lib/status";
import { formatDate, formatSEK } from "@/lib/format";
import type { Expense, Role } from "@/lib/types";

type StatusFilter = "ALL" | "OPEN" | "DONE";

const STATUS_OPTS: SegOption<StatusFilter>[] = [
  { value: "ALL", label: "Alla" },
  { value: "OPEN", label: "Pågående" },
  { value: "DONE", label: "Klara" },
];

const DONE_STATUSES = new Set(["EXPORTED"]);

export function ExpensesClient({
  expenses: allExpenses,
  role,
  userName,
}: {
  expenses: Expense[];
  role: Role;
  userName: string;
}) {
  const router = useRouter();
  const controls = useTableControls();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const base =
    role === "MEMBER"
      ? allExpenses.filter((e) => e.submitterName === userName)
      : allExpenses;

  const filtered = base.filter((e) => {
    if (statusFilter === "OPEN" && DONE_STATUSES.has(e.status)) return false;
    if (statusFilter === "DONE" && !DONE_STATUSES.has(e.status)) return false;
    if (controls.dateFrom && e.purchaseDate < controls.dateFrom) return false;
    if (controls.dateTo && e.purchaseDate > controls.dateTo) return false;
    if (controls.query) {
      const q = controls.query.toLowerCase();
      if (
        !e.title.toLowerCase().includes(q) &&
        !e.id.toLowerCase().includes(q) &&
        !e.submitterName.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const dir = controls.sortDir === "asc" ? 1 : -1;
  const sorted = controls.sortKey
    ? [...filtered].sort((a, b) => {
        switch (controls.sortKey) {
          case "date":      return dir * a.purchaseDate.localeCompare(b.purchaseDate);
          case "title":     return dir * a.title.localeCompare(b.title);
          case "submitter": return dir * a.submitterName.localeCompare(b.submitterName);
          case "amount":    return dir * (a.grossAmount - b.grossAmount);
          default:          return 0;
        }
      })
    : filtered;

  const page = controls.paginate(sorted);

  return (
    <PageShell
      title={role === "MEMBER" ? "Mina utlägg" : "Alla utlägg"}
      description="Spåra status från kvitto till bokföring."
      action={
        <ButtonLink href="/expenses/new">
          <IconPlus className="size-4" />
          Nytt utlägg
        </ButtonLink>
      }
    >
      {base.length === 0 ? (
        <EmptyState
          title="Inga utlägg här"
          description="Skapa ditt första utlägg genom att ladda upp ett kvitto."
          action={
            <ButtonLink href="/expenses/new">
              <IconPlus className="size-4" />
              Nytt utlägg
            </ButtonLink>
          }
        />
      ) : (
        <Card>
          <FilterBar
            query={controls.query}
            onQueryChange={controls.setQuery}
            searchPlaceholder="Sök utlägg…"
            dateFrom={controls.dateFrom}
            onDateFromChange={controls.setDateFrom}
            dateTo={controls.dateTo}
            onDateToChange={controls.setDateTo}
          >
            <SegmentedControl
              size="sm"
              options={STATUS_OPTS}
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v); controls.setPage(0); }}
            />
          </FilterBar>

          {filtered.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted">
              Inga utlägg matchar filtret.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <SortableHeader sortKey="date" controls={controls} className="px-5 py-3">Datum</SortableHeader>
                  <SortableHeader sortKey="title" controls={controls} className="px-5 py-3">Utlägg</SortableHeader>
                  {role !== "MEMBER" && (
                    <SortableHeader sortKey="submitter" controls={controls} className="px-5 py-3">Inlämnad av</SortableHeader>
                  )}
                  <th className="px-5 py-3">Status</th>
                  <SortableHeader sortKey="amount" controls={controls} className="px-5 py-3 text-right">Belopp</SortableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => router.push(`/expenses/${e.id}`)}
                    className="cursor-pointer hover:bg-surface/50"
                  >
                    <td className="whitespace-nowrap px-5 py-4 text-muted">
                      {formatDate(e.purchaseDate)}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium">{e.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {e.id} · <Tag>{PAYMENT_META[e.paymentType].label}</Tag>
                      </p>
                    </td>
                    {role !== "MEMBER" && (
                      <td className="px-5 py-4 text-muted">{e.submitterName}</td>
                    )}
                    <td className="px-5 py-4">
                      <StatusPill status={e.status} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums">
                      {formatSEK(e.grossAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <Pagination
            page={controls.page}
            onPageChange={controls.setPage}
            pageSize={controls.pageSize}
            onPageSizeChange={controls.setPageSize}
            totalItems={filtered.length}
          />
        </Card>
      )}
    </PageShell>
  );
}
