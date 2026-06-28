"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { IconPlus, IconCheck } from "@/components/ui/icons";
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

type ScopeFilter = "MINE" | "ALL";

const SCOPE_OPTS: SegOption<ScopeFilter>[] = [
  { value: "MINE", label: "Mina" },
  { value: "ALL", label: "Alla" },
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

  // Kassör/admin can switch between their own and all utlägg (default: their own).
  const canToggleScope = role === "BOOKKEEPER" || role === "ADMIN";
  const [scope, setScope] = useState<ScopeFilter>("MINE");
  const showOwnOnly = role === "MEMBER" || (canToggleScope && scope === "MINE");

  const base = showOwnOnly
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
      hidden: showOwnOnly,
      sortValue: (e) => e.submitterName,
      className: "text-muted",
      cell: (e) => e.submitterName,
    },
    { key: "status", header: "Status", cell: (e) => <StatusPill status={e.status} /> },
    {
      key: "attest",
      header: "Attest",
      cell: (e) =>
        e.allocations.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="space-y-0.5">
            {e.allocations.map((a) => {
              const attested = !!a.approvedById;
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-1.5 whitespace-nowrap text-xs"
                  title={
                    attested
                      ? `Attesterad av ${a.approvedByName ?? a.approverName}${a.approvedAt ? ` ${formatDate(a.approvedAt)}` : ""}`
                      : `Väntar på attest av ${a.approverName || "—"}`
                  }
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {attested ? (
                      <IconCheck className="size-3.5 text-success" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted/40" />
                    )}
                  </span>
                  <span className={attested ? "font-medium" : "text-muted"}>
                    {a.approverName || "Ej tilldelad"}
                  </span>
                  {e.allocations.length > 1 && (
                    <span className="text-muted/60">{a.costCenterCode}</span>
                  )}
                </div>
              );
            })}
          </div>
        ),
    },
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
      title={showOwnOnly ? "Mina utlägg" : "Alla utlägg"}
      description="Spåra status från kvitto till bokföring."
      action={
        <div className="flex items-center gap-3">
          {canToggleScope && (
            <SegmentedControl
              options={SCOPE_OPTS}
              value={scope}
              onChange={(v) => { setScope(v); controls.setPage(0); }}
            />
          )}
          <ButtonLink href="/expenses/new">
            <IconPlus className="size-4" />
            Nytt utlägg
          </ButtonLink>
        </div>
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
