"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ExpenseList } from "@/components/expense-list";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { useTableControls, FilterBar, Pagination, SortableHeader } from "@/components/ui/table-controls";
import { PAYMENT_META } from "@/lib/status";
import { formatDate, formatSEK } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Expense, Role } from "@/lib/types";

type Tab = "pending" | "attested";

export function ApprovalsClient({
  expenses,
  userId,
  role,
}: {
  expenses: Expense[];
  userId: string;
  role: Role;
}) {
  const router = useRouter();
  const controls = useTableControls();
  const [tab, setTab] = useState<Tab>("pending");

  const pending = expenses.filter(
    (e) =>
      e.status === "PENDING_APPROVAL" &&
      (role === "ADMIN" ||
        e.allocations.some((a) => a.approverId === userId && !a.approvedById)),
  );

  const attested = expenses.filter((e) =>
    e.allocations.some((a) => a.approvedById === userId),
  );

  const pendingTotal = pending.reduce((s, e) => s + e.grossAmount, 0);

  const filtered = attested.filter((e) => {
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
    <>
      <PageHeader
        title="Attestera"
        description="Granska att uppgifterna stämmer och signera utlägget."
      />

      <div className="mb-6 flex gap-1">
        {([["pending", "Väntar"], ["attested", "Attesterade"]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === key ? "bg-accent text-white" : "text-muted hover:text-foreground",
            )}
          >
            {label}
            {key === "pending" && pending.length > 0 && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs tabular-nums">
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "pending" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-md">
            <StatCard label="Väntar på dig" value={String(pending.length)} accent />
            <StatCard label="Summa" value={formatSEK(pendingTotal)} />
          </div>

          {pending.length ? (
            <ExpenseList expenses={pending} />
          ) : (
            <EmptyState
              title="Inget att attestera"
              description="Alla inskickade utlägg är hanterade."
            />
          )}
        </>
      )}

      {tab === "attested" && (
        attested.length === 0 ? (
          <EmptyState
            title="Inga attesterade utlägg"
            description="Utlägg du har attesterat visas här."
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
            />

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
                    <SortableHeader sortKey="submitter" controls={controls} className="px-5 py-3">Inlämnad av</SortableHeader>
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
                      <td className="px-5 py-4 text-muted">{e.submitterName}</td>
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
        )
      )}
    </>
  );
}
