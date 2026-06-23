"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { IconCheck } from "@/components/ui/icons";
import { useTableControls, Pagination, SortableHeader } from "@/components/ui/table-controls";
import { DateInput } from "@/components/ui/date-input";
import { useRole } from "@/components/role-context";
import { useNotify } from "@/components/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatDate, formatSEK } from "@/lib/format";
import type { Expense, ExpenseStatus, FortnoxStatus } from "@/lib/types";

type StatusFilter = "all" | "APPROVED" | "BOOKED" | "EXPORTED";

const STATUS_OPTS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Alla" },
  { value: "APPROVED", label: "Att bokföra" },
  { value: "BOOKED", label: "Att exportera" },
  { value: "EXPORTED", label: "Exporterat" },
];

const BOOKKEEPING_STATUSES = new Set<ExpenseStatus>(["APPROVED", "BOOKED", "EXPORTED"]);

const filterInput =
  "h-8 w-36 rounded-lg border border-border bg-background px-2.5 text-xs placeholder:text-muted/60 focus:border-accent focus:outline-none";

export default function BookkeepingClient({
  expenses,
  fortnox,
}: {
  expenses: Expense[];
  fortnox: FortnoxStatus;
}) {
  const { role } = useRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const notify = useNotify();
  const confirm = useConfirm();
  const controls = useTableControls();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [exporting, setExporting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const isAdmin = role === "ADMIN";
  // Result flag set by the OAuth callback redirect (?fortnox=connected|error).
  const connectResult = searchParams.get("fortnox");
  const connectReason = searchParams.get("reason");

  // Surface the OAuth connect result as a notification, then strip the query
  // params so it doesn't reappear on refresh/navigation.
  useEffect(() => {
    if (connectResult === "connected") notify.success("Fortnox anslöts.");
    else if (connectResult === "error")
      notify.error(`Anslutningen till Fortnox misslyckades${connectReason ? ` (${connectReason})` : ""}.`);
    if (connectResult) window.history.replaceState(null, "", "/bookkeeping");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectResult]);

  const base = expenses.filter((e) => BOOKKEEPING_STATUSES.has(e.status));

  const filtered = base.filter((e) => {
    if (status !== "all" && e.status !== status) return false;
    if (controls.dateFrom && e.purchaseDate < controls.dateFrom) return false;
    if (controls.dateTo && e.purchaseDate > controls.dateTo) return false;
    return true;
  });

  const dir = controls.sortDir === "asc" ? 1 : -1;
  const sorted = controls.sortKey
    ? [...filtered].sort((a, b) => {
        switch (controls.sortKey) {
          case "date":      return dir * a.purchaseDate.localeCompare(b.purchaseDate);
          case "reference": return dir * a.id.localeCompare(b.id);
          case "submitter": return dir * a.submitterName.localeCompare(b.submitterName);
          case "amount":    return dir * (a.grossAmount - b.grossAmount);
          default:          return 0;
        }
      })
    : filtered;
  const page = controls.paginate(sorted);

  async function doExport(id: string) {
    setExporting(id);
    try {
      const res = await fetch(`/api/expenses/${id}/export`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(`${id}: ${data.error ?? "Export misslyckades"}`);
        return;
      }
      if (data.attachWarning) {
        notify.info(`${id}: exporterad (${data.label}), men kvittot kunde inte bifogas — ${data.attachWarning}`);
      } else {
        notify.success(`${id}: exporterad till Fortnox (${data.label}).`);
      }
      router.refresh();
    } catch {
      notify.error(`${id}: kunde inte nå servern`);
    } finally {
      setExporting(null);
    }
  }

  async function doDisconnect() {
    const ok = await confirm({
      title: "Koppla från Fortnox?",
      message: "Inga fler utlägg kan exporteras förrän du ansluter igen.",
      confirmLabel: "Koppla från",
      tone: "danger",
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await fetch("/api/fortnox", { method: "DELETE" });
      notify.success("Fortnox frånkopplat.");
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <PageShell
      title="Bokföring"
      description="Kontera attesterade utlägg och exportera till Fortnox."
    >
      {/* Fortnox connection status */}
      <Card>
        <CardBody className="flex items-center justify-between gap-4">
          {!fortnox.configured ? (
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-surface text-muted">
                <IconCheck className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">Fortnox är inte konfigurerat</p>
                <p className="text-xs text-muted">
                  Servern saknar Fortnox klient-id/secret. Lägg till dem i miljövariablerna.
                </p>
              </div>
            </div>
          ) : fortnox.connected ? (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-success-soft text-success">
                  <IconCheck className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    Fortnox är anslutet{fortnox.companyName ? ` – ${fortnox.companyName}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    Verifikationer och kvitton skickas till serie {fortnox.voucherSeries ?? "A"} vid export.
                  </p>
                </div>
              </div>
              {isAdmin && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disconnecting}
                  onClick={doDisconnect}
                >
                  {disconnecting ? "Kopplar från…" : "Koppla från"}
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-surface text-muted">
                  <IconCheck className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">Fortnox är inte anslutet</p>
                  <p className="text-xs text-muted">
                    {isAdmin
                      ? "Anslut sektionens Fortnox-konto för att kunna exportera verifikationer."
                      : "En administratör behöver ansluta sektionens Fortnox-konto."}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <ButtonLink href="/api/fortnox/connect" size="sm">
                  Anslut Fortnox
                </ButtonLink>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <SegmentedControl<StatusFilter>
            size="sm"
            options={STATUS_OPTS}
            value={status}
            onChange={(v) => { setStatus(v); controls.setPage(0); }}
          />
          <div className="ml-auto flex items-center gap-2">
            <DateInput
              value={controls.dateFrom}
              onChange={(e) => controls.setDateFrom(e.target.value)}
              placeholder="Från"
              className={filterInput}
            />
            <span className="text-xs text-muted">–</span>
            <DateInput
              value={controls.dateTo}
              onChange={(e) => controls.setDateTo(e.target.value)}
              placeholder="Till"
              className={filterInput}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted">
            Inga utlägg matchar filtret.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <SortableHeader sortKey="date" controls={controls} className="px-5 py-3">Datum</SortableHeader>
                <SortableHeader sortKey="reference" controls={controls} className="px-5 py-3">Utlägg</SortableHeader>
                <SortableHeader sortKey="submitter" controls={controls} className="px-5 py-3">Inlämnad av</SortableHeader>
                <SortableHeader sortKey="amount" controls={controls} className="px-5 py-3 text-right">Belopp</SortableHeader>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
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
                    <p className="text-xs text-muted">{e.id}</p>
                  </td>
                  <td className="px-5 py-4 text-muted">{e.submitterName}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums">
                    {formatSEK(e.grossAmount)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusPill status={e.status} />
                  </td>
                  <td className="px-5 py-4 text-right" onClick={(ev) => ev.stopPropagation()}>
                    {e.status === "APPROVED" && (
                      <ButtonLink href={`/expenses/${e.id}/book`} size="sm">
                        Bokför
                      </ButtonLink>
                    )}
                    {e.status === "BOOKED" && (
                      <Button
                        size="sm"
                        disabled={exporting === e.id || !fortnox.connected}
                        title={fortnox.connected ? undefined : "Anslut Fortnox först"}
                        onClick={() => doExport(e.id)}
                      >
                        {exporting === e.id ? "Exporterar…" : "Exportera"}
                      </Button>
                    )}
                    {e.status === "EXPORTED" && e.verification?.fortnoxLabel && (
                      <span className="text-xs text-muted">
                        Verifikat {e.verification.fortnoxLabel}
                      </span>
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
