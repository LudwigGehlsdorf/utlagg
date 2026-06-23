"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconUpload, IconTrash } from "@/components/ui/icons";
import {
  useTableControls,
  FilterBar,
  Pagination,
  type PageSize,
} from "@/components/ui/table-controls";
import { useRole } from "@/components/role-context";
import { useNotify } from "@/components/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { formatDate, formatSEK } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankTransaction } from "@/lib/types";

type ImportResult = {
  imported: number;
  skipped: number;
  cardsCreated: number;
  skippedRows: number;
};

type MatchFilter = "all" | "matched" | "unmatched";

export default function BankClient({
  bankTransactions,
}: {
  bankTransactions: BankTransaction[];
}) {
  const { role } = useRole();
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");

  const controls = useTableControls();
  const canImport = role === "BOOKKEEPER" || role === "ADMIN";

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await fetch("/api/bank/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(data.error ?? "Importen misslyckades");
        return;
      }
      const r = data as ImportResult;
      const parts = [`${r.imported} importerade`];
      if (r.skipped > 0) parts.push(`${r.skipped} dubbletter`);
      if (r.cardsCreated > 0) parts.push(`${r.cardsCreated} nya kort`);
      if (r.skippedRows > 0) parts.push(`${r.skippedRows} rader hoppades över`);
      notify.success(parts.join(" · "), "Import klar");
      router.refresh();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteTxn(id: string) {
    const ok = await confirm({
      title: "Ta bort transaktion?",
      message: "Banktransaktionen tas bort permanent.",
      confirmLabel: "Ta bort",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/bank/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notify.error(data.error ?? "Kunde inte ta bort transaktionen");
        return;
      }
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  // Filter
  const q = controls.query.toLowerCase();
  const filtered = bankTransactions.filter((t) => {
    if (q && (!t.description.toLowerCase().includes(q)) && !t.cardHolderName?.toLowerCase().includes(q)) return false;
    if (controls.dateFrom && t.bookedDate < controls.dateFrom) return false;
    if (controls.dateTo && t.bookedDate > controls.dateTo) return false;
    if (matchFilter === "matched" && !t.matchedExpenseId) return false;
    if (matchFilter === "unmatched" && t.matchedExpenseId) return false;
    return true;
  });

  const page = controls.paginate(filtered);
  const totalMatched = bankTransactions.filter((t) => t.matchedExpenseId).length;

  const select =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:border-accent focus:outline-none";

  return (
    <>
      <PageHeader
        title="Bank & matchning"
        description="Ladda upp kontoutdrag (CSV) och se vilka transaktioner som är matchade."
      />

      {/* CSV upload — bookkeeper/admin only */}
      {canImport && (
        <Card className="mb-8">
          <CardBody>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface/50 px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <IconUpload className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium">Ladda upp kontoutdrag</p>
              <p className="mt-1 text-xs text-muted">
                CSV från banken · dubbletter filtreras bort automatiskt
              </p>
              <Button
                className="mt-4"
                size="sm"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload className="size-4" />
                {busy ? "Importerar…" : "Välj CSV-fil"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Transaction list */}
      <Card>
        <CardHeader
          title="Transaktioner"
          subtitle={`${totalMatched} av ${bankTransactions.length} matchade`}
        />

        <FilterBar
          query={controls.query}
          onQueryChange={controls.setQuery}
          dateFrom={controls.dateFrom}
          onDateFromChange={controls.setDateFrom}
          dateTo={controls.dateTo}
          onDateToChange={controls.setDateTo}
        >
          <select
            value={matchFilter}
            onChange={(e) => {
              setMatchFilter(e.target.value as MatchFilter);
              controls.setPage(0);
            }}
            className={select}
          >
            <option value="all">Alla</option>
            <option value="unmatched">Omatchade</option>
            <option value="matched">Matchade</option>
          </select>
        </FilterBar>

        <ul>
          {page.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-4 border-b border-border px-6 py-3.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.description}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatDate(t.bookedDate)}
                  {t.cardHolderName && (
                    <> · <span>{t.cardHolderName}</span></>
                  )}
                  {t.cardLast4 && !t.cardHolderName && (
                    <> · <span className="tabular-nums">····{t.cardLast4}</span></>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                  t.matchedExpenseId
                    ? "bg-success-soft text-success"
                    : "bg-surface text-muted",
                )}
              >
                {t.matchedExpenseId ? `Matchad · ${t.matchedExpenseId}` : "Omatchad"}
              </span>
              <p
                className={cn(
                  "w-28 shrink-0 text-right text-sm font-semibold tabular-nums",
                  t.amount > 0 && "text-success",
                )}
              >
                {formatSEK(t.amount)}
              </p>
              {canImport && (
                <button
                  onClick={() => deleteTxn(t.id)}
                  disabled={deleting === t.id}
                  title={t.matchedExpenseId ? "Matchad — ta bort matchningen först" : "Ta bort transaktion"}
                  className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </li>
          ))}
          {page.length === 0 && (
            <li className="px-6 py-10 text-center text-sm text-muted">
              Inga transaktioner matchar filtret
            </li>
          )}
        </ul>

        <Pagination
          page={controls.page}
          onPageChange={controls.setPage}
          pageSize={controls.pageSize}
          onPageSizeChange={(n: PageSize) => controls.setPageSize(n)}
          totalItems={filtered.length}
        />
      </Card>
    </>
  );
}
