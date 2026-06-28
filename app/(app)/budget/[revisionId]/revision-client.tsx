"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ButtonLink, Button } from "@/components/ui/button";
import { useRole } from "@/components/role-context";
import { useNotify } from "@/components/notifications";
import { PageHeader } from "@/components/page-header";
import { buildGrid, orderedColumns, type BudgetGrid, type ColumnDef } from "@/lib/budget-grid";
import { cn } from "@/lib/utils";
import type { CostCenter } from "@/lib/types";
import { RAMBUDGET, VARS, OTHER, ccTotals, fmtSigned } from "./budget-helpers";
import { useBudgetCells } from "./use-budget-cells";
import { Rambudget } from "./rambudget";
import { VariablesSheet } from "./variables-sheet";
import { CostCenterSheet } from "./cost-center-sheet";
import type { Revision, BudgetCC } from "./budget-types";

export default function BudgetRevisionClient({
  costCenters: allCostCenters,
}: {
  costCenters: CostCenter[];
}) {
  const { revisionId } = useParams<{ revisionId: string }>();
  const { role, user } = useRole();
  const notify = useNotify();
  const isAdmin = role === "ADMIN";
  const canComment = role === "ADMIN" || role === "APPROVER";

  const [revision, setRevision] = useState<Revision | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(RAMBUDGET);
  const [search, setSearch] = useState("");
  const [addCcId, setAddCcId] = useState("");

  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  // Buffered new-line drafts, keyed by account id (and "__var__" for the new var).
  const [newRow, setNewRow] = useState<Record<string, { description: string; expression: string }>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/budgets/revisions/${revisionId}`);
    if (!res.ok) { setLoading(false); return; }
    setRevision(await res.json());
    setLoading(false);
  }, [revisionId]);

  // load() awaits a fetch before any setState, so this is a deferred update,
  // not a synchronous render cascade.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const api = useCallback(async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: "" }));
      notify.error(msg || `Fel (${res.status})`);
      return false;
    }
    await load();
    return true;
  }, [load, notify]);

  // The fixed column layout, shared across all sheets.
  const columns = useMemo<ColumnDef[]>(() => orderedColumns(), []);

  // A1 grid across all cost-centre sheets, for ↔ token conversion of references.
  const grid = useMemo<BudgetGrid>(() => buildGrid(
    (revision?.costCenters ?? []).map((cc) => ({
      code: cc.costCenter.code,
      accounts: cc.accounts.map((a) => ({
        id: a.id, accountCode: a.accountCode, kindOverride: a.kindOverride,
        lineItems: a.lineItems.map((li) => ({ id: li.id })),
      })),
    })),
    columns,
  ), [revision, columns]);

  // Cell renderers + buffered-edit / focus / edit-mode state + optimistic commit.
  const { renderCell, renderFormula, renderAuto, editing, setEditing } = useBudgetCells({ grid, isAdmin, revision, setRevision, notify, load, api });

  if (loading) return <div className="py-12 text-center text-sm text-muted">Laddar…</div>;
  if (!revision) return <div className="py-12 text-center text-sm text-muted">Revision hittades inte.</div>;

  const ev = revision.evaluated;

  async function createLine(accountId: string) {
    const d = newRow[accountId];
    if (!d) return;
    if (!d.description.trim() && !d.expression.trim()) return;
    const ok = await api(`/api/budgets/accounts/${accountId}/line-items`, "POST", {
      description: d.description.trim(),
      expression: d.expression.trim() || "0",
    });
    if (ok) setNewRow((m) => { const n = { ...m }; delete n[accountId]; return n; });
  }

  // ── Sidebar data ─────────────────────────────────────────────────
  const usedCc = new Set(revision.costCenters.map((c) => c.costCenter.id));
  const availableCc = allCostCenters.filter((c) => !usedCc.has(c.id));
  const q = search.trim().toLowerCase();
  const filteredCc = revision.costCenters.filter((c) =>
    !q || c.costCenter.code.toLowerCase().includes(q) || c.costCenter.name.toLowerCase().includes(q));

  // group filtered cost centers by committee, preserving order
  const groups: { committee: string; items: BudgetCC[] }[] = [];
  for (const cc of filteredCc) {
    const com = cc.costCenter.committee || OTHER;
    let g = groups.find((x) => x.committee === com);
    if (!g) { g = { committee: com, items: [] }; groups.push(g); }
    g.items.push(cc);
  }

  const cc = selected !== RAMBUDGET && selected !== VARS
    ? revision.costCenters.find((c) => c.id === selected) ?? null : null;
  const ccCode = cc?.costCenter.code ?? "";

  return (
    <div>
      <PageHeader
        title={`${revision.budget.name} · ${revision.name}`}
        description={
          <>
            {revision.clonedFrom ? `Klonad från ${revision.clonedFrom.name}` : "Ursprunglig revision"}
            {ev.errors.length > 0 && <span className="ml-2 text-warning">· {ev.errors[0]}</span>}
          </>
        }
        action={<ButtonLink href="/budget" variant="secondary" size="sm">← Alla budgetar</ButtonLink>}
      />

      <div className="flex gap-4">
        {/* ── Sidebar ──────────────────────────────────────────── */}
        <aside className="w-64 shrink-0">
          <div className="overflow-hidden rounded-2xl border border-border bg-background">
            <button
              onClick={() => setSelected(RAMBUDGET)}
              className={cn("flex w-full items-center px-4 py-2.5 text-left text-sm font-medium",
                selected === RAMBUDGET ? "bg-accent-soft text-accent" : "hover:bg-surface")}
            >Rambudget</button>
            <button
              onClick={() => setSelected(VARS)}
              className={cn("flex w-full items-center justify-between border-t border-border px-4 py-2.5 text-left text-sm font-medium",
                selected === VARS ? "bg-accent-soft text-accent" : "hover:bg-surface")}
            >
              <span>Variabler</span>
              <span className="text-xs text-muted">{revision.variables.length}</span>
            </button>
            <div className="border-t border-border px-3 py-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sök kostnadsställe…"
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div className="max-h-[58vh] overflow-y-auto">
              {groups.map((g) => (
                <div key={g.committee}>
                  <p className="bg-surface/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.committee}</p>
                  <ul>
                    {g.items.map((c) => {
                      const { result } = ccTotals(c, ev);
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => setSelected(c.id)}
                            className={cn("flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm",
                              selected === c.id ? "bg-accent-soft text-accent" : "hover:bg-surface")}
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-mono text-xs text-muted">{c.costCenter.code}</span>{" "}{c.costCenter.name}
                            </span>
                            <span className={cn("shrink-0 text-xs tabular-nums",
                              result > 0 ? "text-success" : result < 0 ? "text-danger" : "text-muted")}>{fmtSigned(result)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {groups.length === 0 && <p className="px-4 py-3 text-sm text-muted">Inga kostnadsställen.</p>}
            </div>
            {isAdmin && availableCc.length > 0 && (
              <div className="flex gap-1.5 border-t border-border p-2">
                <select
                  value={addCcId}
                  onChange={(e) => setAddCcId(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs focus:border-accent focus:outline-none"
                >
                  <option value="">+ Lägg till…</option>
                  {availableCc.map((c) => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
                </select>
                <Button size="sm" disabled={!addCcId} onClick={async () => {
                  const ok = await api(`/api/budgets/revisions/${revisionId}/cost-centers`, "POST", { costCenterId: addCcId });
                  if (ok) setAddCcId("");
                }}>OK</Button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main panel ───────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {selected === RAMBUDGET ? (
            <Rambudget revision={revision} ev={ev} onPick={setSelected} />
          ) : selected === VARS ? (
            <VariablesSheet revision={revision} ev={ev}
              isAdmin={isAdmin} renderCell={renderCell} renderFormula={renderFormula} api={api} newVar={newRow["__var__"]?.description ?? ""}
              setNewVar={(v) => setNewRow((m) => ({ ...m, __var__: { description: v, expression: "" } }))}
              revisionId={revisionId} />
          ) : cc ? (
            <CostCenterSheet
              cc={cc} ccCode={ccCode} ev={ev} grid={grid} columns={columns}
              isAdmin={isAdmin} canComment={canComment} userId={user.id}
              renderCell={renderCell} renderFormula={renderFormula} renderAuto={renderAuto} api={api} revisionId={revisionId}
              editing={editing} setEditing={setEditing}
              openComments={openComments} setOpenComments={setOpenComments}
              commentDraft={commentDraft} setCommentDraft={setCommentDraft}
              newRow={newRow} setNewRow={setNewRow} createLine={createLine}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-background px-4 py-12 text-center text-sm text-muted">Välj ett kostnadsställe.</div>
          )}
        </div>
      </div>

      {isAdmin && selected !== RAMBUDGET && (
        <p className="mt-3 text-xs text-muted">
          Skriv ett tal direkt (<code>350</code>) eller en formel med inledande likhetstecken (<code>=350*2</code> visas som <code>700</code>; klicka på cellen för att se formeln igen).
          De sex kolumnerna mellan Beskrivning och Belopp tar tal, procent (<code>67%</code>) eller fri text — tal och procent kan refereras i formler.
          Formler kan referera celler i <strong>A1-form</strong> (<code>=C5*I5</code>, <code>=TEK02!I7</code>), variabler (<code>=MEDLEMMAR*150</code>) och kontosummor (<code>=account(SEX02, 3015)</code>).
          Kolumnbokstäverna står i rubriken och radnumren i vänsterkanten.
        </p>
      )}
    </div>
  );
}
