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
import { DataTable, type Column } from "@/components/ui/data-table";
import { useTableControls, FilterBar, Pagination } from "@/components/ui/table-controls";
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
      hidden: role === "MEMBER",
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
      )}
    </PageShell>
  );
}
