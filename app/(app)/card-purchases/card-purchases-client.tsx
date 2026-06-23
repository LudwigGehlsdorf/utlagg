"use client";

import { useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCard, IconUpload } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useTableControls, FilterBar, Pagination } from "@/components/ui/table-controls";
import { useRole } from "@/components/role-context";
import { formatDate, formatSEK } from "@/lib/format";
import type { BankTransaction, Card as SectionCard } from "@/lib/types";

type StatusFilter = "all" | "unmatched" | "matched";

const STATUS_OPTS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Alla" },
  { value: "unmatched", label: "Ej redovisade" },
  { value: "matched", label: "Redovisade" },
];

export default function CardPurchasesClient({
  bankTransactions,
  cards,
}: {
  bankTransactions: BankTransaction[];
  cards: SectionCard[];
}) {
  const { user } = useRole();
  const controls = useTableControls();
  const [status, setStatus] = useState<StatusFilter>("all");

  const myCards = cards.filter((c) => c.holderId === user.id);
  const showCardCol = myCards.length > 1;

  const myPurchases = bankTransactions
    .filter((t) => t.cardHolderId === user.id && t.amount < 0)
    .sort((a, b) => (a.bookedDate < b.bookedDate ? 1 : -1));

  const unaccountedCount = myPurchases.filter((t) => !t.matchedExpenseId).length;
  const unaccountedTotal = myPurchases
    .filter((t) => !t.matchedExpenseId)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const filtered = myPurchases.filter((t) => {
    if (status === "unmatched" && t.matchedExpenseId) return false;
    if (status === "matched" && !t.matchedExpenseId) return false;
    if (controls.dateFrom && t.bookedDate < controls.dateFrom) return false;
    if (controls.dateTo && t.bookedDate > controls.dateTo) return false;
    if (controls.query && !t.description.toLowerCase().includes(controls.query.toLowerCase()))
      return false;
    return true;
  });

  const columns: Column<BankTransaction>[] = [
    {
      key: "date",
      header: "Datum",
      sortValue: (t) => t.bookedDate,
      className: "whitespace-nowrap text-muted",
      cell: (t) => formatDate(t.bookedDate),
    },
    {
      key: "description",
      header: "Butik",
      sortValue: (t) => t.description,
      className: "font-medium",
      cell: (t) => t.description,
    },
    {
      key: "card",
      header: "Kort",
      hidden: !showCardCol,
      className: "text-muted",
      cell: (t) => (t.cardLast4 ? `····${t.cardLast4}` : "–"),
    },
    {
      key: "amount",
      header: "Belopp",
      align: "right",
      sortValue: (t) => t.amount,
      className: "whitespace-nowrap font-semibold tabular-nums",
      cell: (t) => formatSEK(t.amount),
    },
    {
      key: "matched",
      header: "Utlägg",
      sortValue: (t) => t.matchedExpenseId ?? "",
      cell: (t) =>
        t.matchedExpenseId ? (
          <Link
            href={`/expenses/${t.matchedExpenseId}`}
            className="font-medium text-accent hover:underline"
          >
            {t.matchedExpenseId}
          </Link>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (t) =>
        !t.matchedExpenseId && (
          <ButtonLink href={`/expenses/new?txn=${t.id}`} size="sm">
            <IconUpload className="size-4" />
            Redovisa
          </ButtonLink>
        ),
    },
  ];

  if (myCards.length === 0) {
    return (
      <PageShell title="Kortköp" description="Dina köp med sektionskort." width="content">
        <EmptyState
          title="Du har inget sektionskort"
          description="Kortköp visas här för dig som har ett sektionskort. Hör av dig till kassören om du borde ha ett."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Kortköp"
      description="Alla köp med ditt sektionskort och om de är redovisade."
      width="content"
    >
      {unaccountedCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          <IconCard className="size-4 shrink-0" />
          {unaccountedCount} köp utan kvitto · {formatSEK(unaccountedTotal)} totalt. Ladda upp
          kvittot så matchas köpet automatiskt.
        </div>
      )}

      <Card>
        <FilterBar
          query={controls.query}
          onQueryChange={controls.setQuery}
          searchPlaceholder="Sök köp…"
          dateFrom={controls.dateFrom}
          onDateFromChange={controls.setDateFrom}
          dateTo={controls.dateTo}
          onDateToChange={controls.setDateTo}
        >
          <SegmentedControl<StatusFilter>
            size="sm"
            options={STATUS_OPTS}
            value={status}
            onChange={(v) => {
              setStatus(v);
              controls.setPage(0);
            }}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={filtered}
          controls={controls}
          rowKey={(t) => t.id}
          empty="Inga köp matchar filtret."
        />

        <Pagination
          page={controls.page}
          onPageChange={controls.setPage}
          pageSize={controls.pageSize}
          onPageSizeChange={controls.setPageSize}
          totalItems={filtered.length}
        />
      </Card>
    </PageShell>
  );
}
