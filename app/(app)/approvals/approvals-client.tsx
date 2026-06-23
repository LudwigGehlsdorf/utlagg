"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ExpenseList } from "@/components/expense-list";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/stat-card";
import { StatRow } from "@/components/stat-row";
import { Card } from "@/components/ui/card";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useTableControls, FilterBar, Pagination } from "@/components/ui/table-controls";
import { PAYMENT_META } from "@/lib/status";
import { formatDate, formatSEK } from "@/lib/format";
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

  const columns: Column<Expense>[] = [
    {
      key: "date",
      header: "Datum",
      sortValue: (e) => e.purchaseDate,
      className: "whitespace-nowrap text-muted",
      cell: (e) => formatDate(e.purchaseDate),
    },
    {
      key: "title",
      header: "Utlägg",
      sortValue: (e) => e.title,
      cell: (e) => (
        <>
          <p className="font-medium">{e.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {e.id} · <Tag>{PAYMENT_META[e.paymentType].label}</Tag>
          </p>
        </>
      ),
    },
    {
      key: "submitter",
      header: "Inlämnad av",
      sortValue: (e) => e.submitterName,
      className: "text-muted",
      cell: (e) => e.submitterName,
    },
    { key: "status", header: "Status", cell: (e) => <StatusPill status={e.status} /> },
    {
      key: "amount",
      header: "Belopp",
      align: "right",
      sortValue: (e) => e.grossAmount,
      className: "whitespace-nowrap font-semibold tabular-nums",
      cell: (e) => formatSEK(e.grossAmount),
    },
  ];

  return (
    <PageShell
      title="Attestera"
      description="Granska att uppgifterna stämmer och signera utlägget."
    >
      <SegmentedControl<Tab>
        options={[
          { value: "pending", label: "Väntar", badge: pending.length },
          { value: "attested", label: "Attesterade" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "pending" && (
        <div className="space-y-6">
          <StatRow>
            <StatCard label="Väntar på dig" value={String(pending.length)} accent />
            <StatCard label="Summa" value={formatSEK(pendingTotal)} />
          </StatRow>

          {pending.length ? (
            <ExpenseList expenses={pending} />
          ) : (
            <EmptyState
              title="Inget att attestera"
              description="Alla inskickade utlägg är hanterade."
            />
          )}
        </div>
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

            <DataTable
              columns={columns}
              rows={filtered}
              controls={controls}
              rowKey={(e) => e.id}
              onRowClick={(e) => router.push(`/expenses/${e.id}`)}
              empty="Inga utlägg matchar filtret."
            />

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
    </PageShell>
  );
}
