"use client";

import { useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCard, IconUpload } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTableControls, FilterBar, Pagination, SortableHeader } from "@/components/ui/table-controls";
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

  const dir = controls.sortDir === "asc" ? 1 : -1;
  const sorted = controls.sortKey
    ? [...filtered].sort((a, b) => {
        switch (controls.sortKey) {
          case "date":        return dir * a.bookedDate.localeCompare(b.bookedDate);
          case "description": return dir * a.description.localeCompare(b.description);
          case "amount":      return dir * (a.amount - b.amount);
          case "matched":     return dir * (a.matchedExpenseId ?? "").localeCompare(b.matchedExpenseId ?? "");
          default:            return 0;
        }
      })
    : filtered;
  const page = controls.paginate(sorted);

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

        {filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted">
            Inga köp matchar filtret.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <SortableHeader sortKey="date" controls={controls} className="px-5 py-3">Datum</SortableHeader>
                <SortableHeader sortKey="description" controls={controls} className="px-5 py-3">Butik</SortableHeader>
                {showCardCol && <th className="px-5 py-3">Kort</th>}
                <SortableHeader sortKey="amount" controls={controls} className="px-5 py-3 text-right">Belopp</SortableHeader>
                <SortableHeader sortKey="matched" controls={controls} className="px-5 py-3">Utlägg</SortableHeader>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.map((t) => (
                <tr key={t.id} className="hover:bg-surface/50">
                  <td className="whitespace-nowrap px-5 py-4 text-muted">
                    {formatDate(t.bookedDate)}
                  </td>
                  <td className="px-5 py-4 font-medium">{t.description}</td>
                  {showCardCol && (
                    <td className="px-5 py-4 text-muted">
                      {t.cardLast4 ? `····${t.cardLast4}` : "–"}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums">
                    {formatSEK(t.amount)}
                  </td>
                  <td className="px-5 py-4">
                    {t.matchedExpenseId ? (
                      <Link
                        href={`/expenses/${t.matchedExpenseId}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {t.matchedExpenseId}
                      </Link>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {!t.matchedExpenseId && (
                      <ButtonLink href={`/expenses/new?txn=${t.id}`} size="sm">
                        <IconUpload className="size-4" />
                        Redovisa
                      </ButtonLink>
                    )}
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
    </PageShell>
  );
}
