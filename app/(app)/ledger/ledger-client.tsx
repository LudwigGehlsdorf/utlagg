"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useRole } from "@/components/role-context";
import { useNotify } from "@/components/notifications";
import { formatDate, formatDateTime, formatSEK } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FortnoxStatus } from "@/lib/types";

interface SpendAccount {
  account: string;
  accountName: string;
  debit: number;
  credit: number;
  net: number;
}
interface SpendGroup {
  costCenterCode: string | null;
  costCenterName: string | null;
  accounts: SpendAccount[];
  debit: number;
  credit: number;
  net: number;
}
interface LedgerYear {
  id: number;
  year: number;
  lastSyncAt: string | null;
}
interface SpendResponse {
  years: LedgerYear[];
  year: LedgerYear | null;
  groups: SpendGroup[];
}
interface RowView {
  id: string;
  date: string;
  voucher: string;
  description: string;
  text: string | null;
  debit: number;
  credit: number;
}

const filterInput =
  "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:border-accent focus:outline-none";

export default function LedgerClient({ fortnox }: { fortnox: FortnoxStatus }) {
  const { role } = useRole();
  const notify = useNotify();
  const canSync = role === "BOOKKEEPER" || role === "ADMIN";

  const [data, setData] = useState<SpendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [ccFilter, setCcFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Per (cc|account) drill-down state.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowView[]>>({});

  const load = useCallback(async (y: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ledger/spend${y != null ? `?year=${y}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte hämta utfall");
      setData(json);
      setYear(json.year?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Något gick fel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  function changeYear(y: number) {
    setOpenKey(null);
    setRows({});
    load(y);
  }

  async function doSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/fortnox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "current" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Synk misslyckades");
      notify.success(`Synkade ${json.totalVouchers} verifikationer.`, "Synk klar");
      await load(year);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Synk misslyckades");
    } finally {
      setSyncing(false);
    }
  }

  async function toggleRow(group: SpendGroup, acct: SpendAccount) {
    const key = `${group.costCenterCode ?? ""}|${acct.account}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (!rows[key] && year != null) {
      const params = new URLSearchParams({ year: String(year), account: acct.account });
      if (group.costCenterCode) params.set("costCenter", group.costCenterCode);
      const res = await fetch(`/api/ledger/rows?${params.toString()}`);
      const json = await res.json();
      if (res.ok) setRows((r) => ({ ...r, [key]: json.rows }));
    }
  }

  const ccOptions = useMemo(() => {
    if (!data) return [];
    return data.groups.map((g) => ({
      code: g.costCenterCode ?? "",
      label: g.costCenterCode
        ? `${g.costCenterCode} · ${g.costCenterName ?? ""}`
        : "Utan kostnadsställe",
    }));
  }, [data]);

  const visibleGroups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.groups
      .filter((g) => ccFilter === "all" || (g.costCenterCode ?? "") === ccFilter)
      .map((g) => ({
        ...g,
        accounts: q
          ? g.accounts.filter(
              (a) =>
                a.account.includes(q) || a.accountName.toLowerCase().includes(q),
            )
          : g.accounts,
      }))
      .filter((g) => g.accounts.length > 0);
  }, [data, ccFilter, query]);

  const grandNet = useMemo(
    () => visibleGroups.reduce((s, g) => s + g.accounts.reduce((t, a) => t + a.net, 0), 0),
    [visibleGroups],
  );

  const selectedYear = data?.years.find((y) => y.id === year) ?? null;

  return (
    <PageShell
      title="Utfall"
      description="Bokfört utfall per konto och kostnadsställe, hämtat från Fortnox."
    >
      {/* Sync status */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {!fortnox.connected ? (
              <span className="text-muted">
                Fortnox är inte anslutet — anslut under Bokföring för att kunna synka.
              </span>
            ) : selectedYear?.lastSyncAt ? (
              <span className="text-muted">
                Senast synkad {formatDateTime(selectedYear.lastSyncAt)}
              </span>
            ) : (
              <span className="text-muted">Ännu inte synkad för valt år.</span>
            )}
          </div>
          {canSync && fortnox.connected && (
            <Button size="sm" disabled={syncing} onClick={doSync}>
              {syncing ? "Synkar…" : "Synka innevarande år"}
            </Button>
          )}
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={year ?? ""}
          onChange={(e) => changeYear(Number(e.target.value))}
          className={filterInput}
        >
          {data?.years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.year}
            </option>
          ))}
        </select>
        <select
          value={ccFilter}
          onChange={(e) => setCcFilter(e.target.value)}
          className={cn(filterInput, "max-w-xs")}
        >
          <option value="all">Alla kostnadsställen</option>
          {ccOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök konto…"
          className={cn(filterInput, "w-44")}
        />
        <span className="ml-auto text-sm text-muted">
          Summa netto:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatSEK(grandNet)}
          </span>
        </span>
      </div>

      {error ? (
        <EmptyState title="Kunde inte hämta utfall" description={error} />
      ) : loading ? (
        <p className="px-1 py-12 text-center text-sm text-muted">Laddar…</p>
      ) : !data?.years.length ? (
        <EmptyState
          title="Inget utfall ännu"
          description="Synka från Fortnox för att hämta in bokförda verifikationer."
        />
      ) : visibleGroups.length === 0 ? (
        <p className="px-1 py-12 text-center text-sm text-muted">Inga rader matchar filtret.</p>
      ) : (
        <div className="space-y-5">
          {visibleGroups.map((g) => {
            const net = g.accounts.reduce((s, a) => s + a.net, 0);
            return (
              <Card key={g.costCenterCode ?? "none"}>
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {g.costCenterCode
                        ? `${g.costCenterCode} · ${g.costCenterName ?? ""}`
                        : "Utan kostnadsställe"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatSEK(net)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-5 py-2 font-medium">Konto</th>
                      <th className="px-2 py-2 text-right font-medium">Debet</th>
                      <th className="px-2 py-2 text-right font-medium">Kredit</th>
                      <th className="px-5 py-2 text-right font-medium">Netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.accounts.map((a) => {
                      const key = `${g.costCenterCode ?? ""}|${a.account}`;
                      const open = openKey === key;
                      return (
                        <Fragment key={key}>
                          <tr
                            onClick={() => toggleRow(g, a)}
                            className="cursor-pointer border-t border-border hover:bg-surface/50"
                          >
                            <td className="px-5 py-2">
                              <span className="font-medium tabular-nums">{a.account}</span>{" "}
                              <span className="text-muted">{a.accountName}</span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-muted">
                              {a.debit ? formatSEK(a.debit) : ""}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-muted">
                              {a.credit ? formatSEK(a.credit) : ""}
                            </td>
                            <td className="px-5 py-2 text-right font-medium tabular-nums">
                              {formatSEK(a.net)}
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-t border-border bg-surface/30">
                              <td colSpan={4} className="px-5 py-3">
                                {!rows[key] ? (
                                  <p className="text-xs text-muted">Laddar verifikationer…</p>
                                ) : rows[key].length === 0 ? (
                                  <p className="text-xs text-muted">Inga rader.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <tbody>
                                      {rows[key].map((r) => (
                                        <tr key={r.id} className="text-muted">
                                          <td className="py-1 pr-3 whitespace-nowrap">
                                            {formatDate(r.date)}
                                          </td>
                                          <td className="py-1 pr-3 whitespace-nowrap font-medium text-foreground">
                                            {r.voucher}
                                          </td>
                                          <td className="py-1 pr-3">
                                            {r.text || r.description}
                                          </td>
                                          <td className="py-1 pr-3 text-right tabular-nums whitespace-nowrap">
                                            {r.debit ? formatSEK(r.debit) : ""}
                                          </td>
                                          <td className="py-1 text-right tabular-nums whitespace-nowrap">
                                            {r.credit ? formatSEK(r.credit) : ""}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
