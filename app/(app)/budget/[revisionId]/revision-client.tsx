"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ButtonLink, Button } from "@/components/ui/button";
import { useRole } from "@/components/role-context";
import { effectiveKind, type AccountKind } from "@/lib/budget";
import { cn } from "@/lib/utils";
import type { CostCenter } from "@/lib/types";

// ── Types (mirror the API response) ───────────────────────────────

interface LineItem {
  id: string; description: string;
  quantity: string | null; unitPrice: string | null; expression: string;
  sortOrder: number;
}
interface Comment { id: string; body: string; createdAt: string; author: { id: string; name: string } }
interface Account {
  id: string; accountCode: string; accountName: string; sortOrder: number;
  kindOverride: AccountKind | null;
  lineItems: LineItem[]; comments: Comment[];
}
interface BudgetCC { id: string; sortOrder: number; costCenter: { id: string; code: string; name: string; committee: string | null }; accounts: Account[] }
interface Variable { id: string; name: string; expression: string; sortOrder: number }
interface Evaluated { vars: Record<string, number>; accounts: Record<string, number>; lineItems: Record<string, number>; errors: string[] }
interface Revision {
  id: string; name: string; budgetId: string;
  createdBy: { name: string }; clonedFrom: { id: string; name: string } | null;
  budget: { id: string; year: number; name: string; baselineRevisionId: string | null };
  variables: Variable[]; costCenters: BudgetCC[]; evaluated: Evaluated;
  // Actual outcome from the Fortnox ledger, keyed `${ccCode}:${accountCode}` (SEK,
  // oriented by account kind). Present only where a cost-centre code matches.
  actuals?: Record<string, number>; actualsSynced?: boolean; actualsYear?: number;
}

const RAMBUDGET = "__rambudget__";
const VARS = "__vars__";
const OTHER = "Övrigt";

interface CellArgs {
  id: string; field: string; actual: string; className?: string; placeholder?: string; mono?: boolean;
  url: string; payload: (v: string) => Record<string, unknown>;
}
type CellFn = (a: CellArgs) => React.ReactNode;

const numFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const fmt = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "—" : numFmt.format(n);
const fmtSigned = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "—" : (n > 0 ? "+" : "") + numFmt.format(n);

// Income / cost split for one cost center under a given evaluation.
function ccTotals(cc: BudgetCC, ev: Evaluated | undefined) {
  let income = 0, cost = 0;
  for (const a of cc.accounts) {
    const t = ev?.accounts[`${cc.costCenter.code}:${a.accountCode}`] ?? 0;
    if (effectiveKind(a.accountCode, a.kindOverride) === "INCOME") income += t; else cost += t;
  }
  return { income, cost, result: income - cost };
}

export default function BudgetRevisionClient({
  costCenters: allCostCenters,
}: {
  costCenters: CostCenter[];
}) {
  const { revisionId } = useParams<{ revisionId: string }>();
  const { role, user } = useRole();
  const isAdmin = role === "ADMIN";
  const canComment = role === "ADMIN" || role === "APPROVER";

  const [revision, setRevision] = useState<Revision | null>(null);
  const [baseline, setBaseline] = useState<Revision | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(RAMBUDGET);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addCcId, setAddCcId] = useState("");

  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  // Buffered in-progress cell edits, keyed `${id}:${field}`.
  const [pending, setPending] = useState<Record<string, string>>({});
  // Buffered new-line drafts, keyed by account id.
  const [newRow, setNewRow] = useState<Record<string, { description: string; quantity: string; unitPrice: string; expression: string }>>({});
  const [newAccount, setNewAccount] = useState({ code: "", name: "" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/budgets/revisions/${revisionId}`);
    if (!res.ok) { setLoading(false); return; }
    const data: Revision = await res.json();
    setRevision(data);
    const baseId = data.budget.baselineRevisionId;
    if (baseId && baseId !== data.id) {
      const br = await fetch(`/api/budgets/revisions/${baseId}`);
      setBaseline(br.ok ? await br.json() : null);
    } else {
      setBaseline(null);
    }
    setLoading(false);
  }, [revisionId]);

  // load() awaits a fetch before any setState, so this is a deferred update,
  // not a synchronous render cascade.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function api(url: string, method: string, body?: unknown) {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: "" }));
      setError(msg || `Fel (${res.status})`);
      return false;
    }
    await load();
    return true;
  }

  // ── Baseline lookups (the "antagen" comparison column) ───────────
  const baseLookup = useMemo(() => {
    const accounts = new Map<string, number>();        // `${ccCode}:${acctCode}` → total
    const lines = new Map<string, number>();           // `${ccCode}|${acctCode}|${desc}` → value
    const vars = new Map<string, number>();            // name → value
    if (!baseline) return { accounts, lines, vars };
    for (const [k, v] of Object.entries(baseline.evaluated.vars)) vars.set(k, v);
    for (const cc of baseline.costCenters) {
      const code = cc.costCenter.code;
      for (const a of cc.accounts) {
        accounts.set(`${code}:${a.accountCode}`, baseline.evaluated.accounts[`${code}:${a.accountCode}`] ?? 0);
        for (const li of a.lineItems) {
          lines.set(`${code}|${a.accountCode}|${li.description}`, baseline.evaluated.lineItems[li.id] ?? 0);
        }
      }
    }
    return { accounts, lines, vars };
  }, [baseline]);

  if (loading) return <div className="py-12 text-center text-sm text-muted">Laddar…</div>;
  if (!revision) return <div className="py-12 text-center text-sm text-muted">Revision hittades inte.</div>;

  const ev = revision.evaluated;
  const baseName = baseline?.name ?? "Antagen";

  // ── Editing helpers ──────────────────────────────────────────────
  const pVal = (id: string, field: string, actual: string) => pending[`${id}:${field}`] ?? actual;
  const setP = (id: string, field: string, v: string) => setPending((p) => ({ ...p, [`${id}:${field}`]: v }));
  const clearP = (id: string, field: string) => setPending((p) => { const n = { ...p }; delete n[`${id}:${field}`]; return n; });

  async function commit(id: string, field: string, actual: string, url: string, payload: (v: string) => Record<string, unknown>) {
    const key = `${id}:${field}`;
    const v = pending[key];
    if (v === undefined || v.trim() === actual.trim()) { clearP(id, field); return; }
    await api(url, "PATCH", payload(v.trim()));
    clearP(id, field);
  }

  // An editable text cell (admin only); otherwise a static value. Invoked as a
  // plain function (not <Cell/>) so the <input> reconciles by position and keeps
  // focus across re-renders instead of remounting on every keystroke.
  function renderCell({ id, field, actual, className, placeholder, mono, url, payload }: CellArgs) {
    if (!isAdmin) {
      return <div className={cn("px-2 py-1.5 min-h-[32px]", mono && "font-mono text-xs", className)}>{actual || <span className="text-muted/40">{placeholder}</span>}</div>;
    }
    return (
      <input
        value={pVal(id, field, actual)}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commit(id, field, actual, url, payload)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { clearP(id, field); (e.target as HTMLInputElement).blur(); } }}
        placeholder={placeholder}
        className={cn("w-full bg-transparent px-2 py-1.5 outline-none focus:bg-accent-soft/40 focus:ring-1 focus:ring-inset focus:ring-accent", mono && "font-mono text-xs", className)}
      />
    );
  }

  async function createLine(accountId: string) {
    const d = newRow[accountId];
    if (!d) return;
    const hasQU = d.quantity.trim() && d.unitPrice.trim();
    if (!d.description.trim() && !hasQU && !d.expression.trim()) return;
    const ok = await api(`/api/budgets/accounts/${accountId}/line-items`, "POST", {
      description: d.description.trim(),
      quantity: d.quantity.trim() || undefined,
      unitPrice: d.unitPrice.trim() || undefined,
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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{revision.budget.name} · {revision.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {baseline ? `Jämförs mot ${baseName}` : "Ursprunglig revision"}
            {ev.errors.length > 0 && <span className="ml-2 text-warning">· {ev.errors[0]}</span>}
          </p>
        </div>
        <ButtonLink href="/budget" variant="secondary" size="sm">← Alla budgetar</ButtonLink>
      </div>

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

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
            <Rambudget revision={revision} ev={ev} baseline={baseline} baseName={baseName} onPick={setSelected} />
          ) : selected === VARS ? (
            <VariablesSheet revision={revision} ev={ev} baseLookup={baseLookup} baseName={baseName}
              isAdmin={isAdmin} renderCell={renderCell} api={api} newVar={newRow["__var__"]?.description ?? ""}
              setNewVar={(v) => setNewRow((m) => ({ ...m, __var__: { description: v, quantity: "", unitPrice: "", expression: "" } }))}
              revisionId={revisionId} />
          ) : cc ? (
            <CostCenterSheet
              cc={cc} ccCode={ccCode} ev={ev} baseLookup={baseLookup} baseName={baseName}
              isAdmin={isAdmin} canComment={canComment} userId={user.id}
              renderCell={renderCell} api={api} revisionId={revisionId}
              openComments={openComments} setOpenComments={setOpenComments}
              commentDraft={commentDraft} setCommentDraft={setCommentDraft}
              newRow={newRow} setNewRow={setNewRow} createLine={createLine}
              newAccount={newAccount} setNewAccount={setNewAccount}
              actuals={revision.actuals ?? {}} actualsSynced={revision.actualsSynced ?? false}
              actualsYear={revision.actualsYear ?? revision.budget.year}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-background px-4 py-12 text-center text-sm text-muted">Välj ett kostnadsställe.</div>
          )}
        </div>
      </div>

      {isAdmin && selected !== RAMBUDGET && (
        <p className="mt-3 text-xs text-muted">
          Fyll i <strong>Antal</strong> och <strong>á-pris</strong> för en uträknad rad, eller skriv beloppet/formeln direkt i <strong>Belopp</strong>.
          Formler kan referera variabler: <code>MEDLEMMAR * 150</code>, <code>TACK_POLICY</code>, <code>account(SEX02, 3015)</code>.
        </p>
      )}
    </div>
  );
}

// ── Rambudget overview ──────────────────────────────────────────────

function Rambudget({ revision, ev, baseline, baseName, onPick }: {
  revision: Revision; ev: Evaluated; baseline: Revision | null; baseName: string; onPick: (id: string) => void;
}) {
  const baseTotals = useMemo(() => {
    const m = new Map<string, { income: number; cost: number }>();
    if (!baseline) return m;
    for (const cc of baseline.costCenters) {
      const t = ccTotals(cc, baseline.evaluated);
      m.set(cc.costCenter.code, { income: t.income, cost: t.cost });
    }
    return m;
  }, [baseline]);

  const groups: { committee: string; items: BudgetCC[] }[] = [];
  for (const cc of revision.costCenters) {
    const com = cc.costCenter.committee || "Övrigt";
    let g = groups.find((x) => x.committee === com);
    if (!g) { g = { committee: com, items: [] }; groups.push(g); }
    g.items.push(cc);
  }

  let gInc = 0, gCost = 0, gbInc = 0, gbCost = 0;
  for (const cc of revision.costCenters) {
    const t = ccTotals(cc, ev); gInc += t.income; gCost += t.cost;
    const b = baseTotals.get(cc.costCenter.code); if (b) { gbInc += b.income; gbCost += b.cost; }
  }

  const numCls = "px-3 py-1.5 text-right tabular-nums";
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-background">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th className="px-3 py-2 text-left font-medium">Kostnadsställe</th>
            <th className="border-l border-border px-3 py-2 text-center font-medium" colSpan={3}>{revision.name}</th>
            <th className="border-l border-border px-3 py-2 text-center font-medium" colSpan={3}>{baseName}</th>
          </tr>
          <tr className="border-b border-border text-[11px] text-muted">
            <th />
            <th className={cn("border-l border-border font-medium", numCls)}>Intäkter</th>
            <th className={cn("font-medium", numCls)}>Kostnader</th>
            <th className={cn("font-medium", numCls)}>Resultat</th>
            <th className={cn("border-l border-border font-medium", numCls)}>Intäkter</th>
            <th className={cn("font-medium", numCls)}>Kostnader</th>
            <th className={cn("font-medium", numCls)}>Resultat</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b-2 border-border bg-surface/50 font-semibold">
            <td className="px-3 py-2">Totalt</td>
            <td className={cn("border-l border-border", numCls)}>{fmt(gInc)}</td>
            <td className={numCls}>{fmt(gCost)}</td>
            <td className={cn(numCls, gInc - gCost < 0 ? "text-danger" : "text-success")}>{fmtSigned(gInc - gCost)}</td>
            <td className={cn("border-l border-border", numCls)}>{fmt(gbInc)}</td>
            <td className={numCls}>{fmt(gbCost)}</td>
            <td className={cn(numCls, gbInc - gbCost < 0 ? "text-danger" : "text-success")}>{fmtSigned(gbInc - gbCost)}</td>
          </tr>
          {groups.map((g) => {
            let si = 0, sc = 0, sbi = 0, sbc = 0;
            for (const cc of g.items) {
              const t = ccTotals(cc, ev); si += t.income; sc += t.cost;
              const b = baseTotals.get(cc.costCenter.code); if (b) { sbi += b.income; sbc += b.cost; }
            }
            return (
              <FragmentGroup key={g.committee} committee={g.committee} si={si} sc={sc} sbi={sbi} sbc={sbc}>
                {g.items.map((cc) => {
                  const t = ccTotals(cc, ev);
                  const b = baseTotals.get(cc.costCenter.code) ?? { income: 0, cost: 0 };
                  return (
                    <tr key={cc.id} className="cursor-pointer border-b border-border/50 hover:bg-surface/60" onClick={() => onPick(cc.id)}>
                      <td className="px-3 py-1.5">
                        <span className="font-mono text-xs text-muted">{cc.costCenter.code}</span>{" "}{cc.costCenter.name}
                      </td>
                      <td className={cn("border-l border-border/50", numCls)}>{fmt(t.income)}</td>
                      <td className={numCls}>{fmt(t.cost)}</td>
                      <td className={cn(numCls, t.result < 0 ? "text-danger" : t.result > 0 ? "text-success" : "text-muted")}>{fmtSigned(t.result)}</td>
                      <td className={cn("border-l border-border/50 text-muted", numCls)}>{fmt(b.income)}</td>
                      <td className={cn("text-muted", numCls)}>{fmt(b.cost)}</td>
                      <td className={cn("text-muted", numCls)}>{fmtSigned(b.income - b.cost)}</td>
                    </tr>
                  );
                })}
              </FragmentGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentGroup({ committee, si, sc, sbi, sbc, children }: {
  committee: string; si: number; sc: number; sbi: number; sbc: number; children: React.ReactNode;
}) {
  const numCls = "px-3 py-1.5 text-right tabular-nums";
  return (
    <>
      <tr className="border-b border-border bg-surface/30">
        <td className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted" colSpan={7}>{committee}</td>
      </tr>
      {children}
      <tr className="border-b border-border text-sm font-medium">
        <td className="px-3 py-1.5 pl-6 text-muted">Totalt {committee.toLowerCase()}</td>
        <td className={cn("border-l border-border/50", numCls)}>{fmt(si)}</td>
        <td className={numCls}>{fmt(sc)}</td>
        <td className={cn(numCls, si - sc < 0 ? "text-danger" : "text-success")}>{fmtSigned(si - sc)}</td>
        <td className={cn("border-l border-border/50 text-muted", numCls)}>{fmt(sbi)}</td>
        <td className={cn("text-muted", numCls)}>{fmt(sbc)}</td>
        <td className={cn("text-muted", numCls)}>{fmtSigned(sbi - sbc)}</td>
      </tr>
    </>
  );
}

// ── Variables sheet ─────────────────────────────────────────────────

function VariablesSheet({ revision, ev, baseLookup, baseName, isAdmin, renderCell, api, newVar, setNewVar, revisionId }: {
  revision: Revision; ev: Evaluated; baseLookup: { vars: Map<string, number> }; baseName: string;
  isAdmin: boolean; renderCell: CellFn; api: (u: string, m: string, b?: unknown) => Promise<boolean>;
  newVar: string; setNewVar: (v: string) => void; revisionId: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            <th className="w-52 px-3 py-2">Variabel</th>
            <th className="px-3 py-2">Uttryck</th>
            <th className="w-28 px-3 py-2 text-right">Värde</th>
            <th className="w-28 px-3 py-2 text-right">{baseName}</th>
            {isAdmin && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {revision.variables.map((v) => (
            <tr key={v.id} className="border-b border-border/60">
              <td className="border-r border-border/60 p-0">
                {renderCell({ id: v.id, field: "name", actual: v.name, mono: true, url: `/api/budgets/variables/${v.id}`, payload: (x) => ({ name: x.toUpperCase() }) })}
              </td>
              <td className="border-r border-border/60 p-0">
                {renderCell({ id: v.id, field: "expression", actual: v.expression, mono: true, placeholder: "0", url: `/api/budgets/variables/${v.id}`, payload: (x) => ({ expression: x }) })}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(ev.vars[v.name])}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted">{fmt(baseLookup.vars.get(v.name))}</td>
              {isAdmin && (
                <td className="px-1 text-center">
                  <button onClick={() => api(`/api/budgets/variables/${v.id}`, "DELETE")} className="text-muted hover:text-danger">×</button>
                </td>
              )}
            </tr>
          ))}
          {isAdmin && (
            <tr className="border-b border-border/60">
              <td className="border-r border-border/60 p-0" colSpan={2}>
                <input
                  value={newVar}
                  onChange={(e) => setNewVar(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter" || !newVar.trim()) return;
                    const ok = await api(`/api/budgets/revisions/${revisionId}/variables`, "POST", { name: newVar.trim().toUpperCase(), expression: "0" });
                    if (ok) setNewVar("");
                  }}
                  placeholder="+ ny variabel (namn, Enter)"
                  className="w-full bg-transparent px-3 py-1.5 font-mono text-xs outline-none placeholder:text-muted/40 focus:bg-accent-soft/40"
                />
              </td>
              <td /><td />{isAdmin && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Cost-center sheet ───────────────────────────────────────────────

function CostCenterSheet(props: {
  cc: BudgetCC; ccCode: string; ev: Evaluated;
  baseLookup: { accounts: Map<string, number>; lines: Map<string, number> }; baseName: string;
  isAdmin: boolean; canComment: boolean; userId: string;
  renderCell: CellFn; api: (u: string, m: string, b?: unknown) => Promise<boolean>; revisionId: string;
  openComments: Set<string>; setOpenComments: React.Dispatch<React.SetStateAction<Set<string>>>;
  commentDraft: Record<string, string>; setCommentDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  newRow: Record<string, { description: string; quantity: string; unitPrice: string; expression: string }>;
  setNewRow: React.Dispatch<React.SetStateAction<Record<string, { description: string; quantity: string; unitPrice: string; expression: string }>>>;
  createLine: (accountId: string) => Promise<void>;
  newAccount: { code: string; name: string }; setNewAccount: React.Dispatch<React.SetStateAction<{ code: string; name: string }>>;
  actuals: Record<string, number>; actualsSynced: boolean; actualsYear: number;
}) {
  const { cc, ccCode, ev, baseLookup, baseName, isAdmin, canComment, userId, renderCell, api, revisionId,
    openComments, setOpenComments, commentDraft, setCommentDraft, newRow, setNewRow, createLine, newAccount, setNewAccount,
    actuals, actualsSynced, actualsYear } = props;
  const actualOf = (accountCode: string) =>
    actualsSynced ? actuals[`${ccCode}:${accountCode}`] : undefined;

  const income = cc.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "INCOME");
  const cost = cc.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "COST");
  const totals = ccTotals(cc, ev);
  // Baseline income/cost: the lookup holds account totals without kind, so
  // re-split by the current revision's kinds.
  let bInc = 0, bCost = 0;
  let aInc = 0, aCost = 0;
  for (const a of cc.accounts) {
    const t = baseLookup.accounts.get(`${ccCode}:${a.accountCode}`) ?? 0;
    const act = actuals[`${ccCode}:${a.accountCode}`] ?? 0;
    if (effectiveKind(a.accountCode, a.kindOverride) === "INCOME") { bInc += t; aInc += act; }
    else { bCost += t; aCost += act; }
  }

  const draft = (id: string) => newRow[id] ?? { description: "", quantity: "", unitPrice: "", expression: "" };
  const setDraft = (id: string, patch: Partial<{ description: string; quantity: string; unitPrice: string; expression: string }>) =>
    setNewRow((m) => ({ ...m, [id]: { ...draft(id), ...patch } }));

  function accountBlock(account: Account) {
    const total = ev.accounts[`${ccCode}:${account.accountCode}`];
    const baseTotal = baseLookup.accounts.get(`${ccCode}:${account.accountCode}`);
    const open = openComments.has(account.id);
    const d = draft(account.id);
    return (
      <tbody key={account.id} className="border-b border-border">
        <tr className="bg-surface/40">
          <td className="border-r border-border/60 p-0 align-top">
            {renderCell({ id: account.id, field: "accountCode", actual: account.accountCode, mono: true, className: "font-semibold text-muted", url: `/api/budgets/accounts/${account.id}`, payload: (v) => ({ accountCode: v }) })}
          </td>
          <td className="border-r border-border/60 p-0" colSpan={3}>
            {renderCell({ id: account.id, field: "accountName", actual: account.accountName, className: "font-semibold", placeholder: "Kontonamn", url: `/api/budgets/accounts/${account.id}`, payload: (v) => ({ accountName: v }) })}
          </td>
          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(total)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-muted">{fmt(baseTotal)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-muted">{actualsSynced ? fmt(actualOf(account.accountCode)) : "—"}</td>
          <td className="whitespace-nowrap px-1 text-center text-xs text-muted">
            {isAdmin && (
              <select
                value={account.kindOverride ?? ""}
                onChange={(e) => api(`/api/budgets/accounts/${account.id}`, "PATCH", { kindOverride: e.target.value })}
                title="Intäkt/kostnad"
                className="mr-1 rounded border border-border bg-background px-0.5 py-0.5 text-[10px]"
              >
                <option value="">auto</option>
                <option value="INCOME">int</option>
                <option value="COST">kost</option>
              </select>
            )}
            {canComment && (
              <button
                onClick={() => setOpenComments((s) => { const n = new Set(s); if (n.has(account.id)) n.delete(account.id); else n.add(account.id); return n; })}
                className={cn("px-1 hover:text-foreground", open && "text-accent")} title="Kommentarer"
              >💬{account.comments.length || ""}</button>
            )}
            {isAdmin && <button onClick={() => api(`/api/budgets/accounts/${account.id}`, "DELETE")} className="px-1 hover:text-danger" title="Ta bort konto">×</button>}
          </td>
        </tr>

        {account.lineItems.map((li) => {
          const structured = !!(li.quantity && li.unitPrice);
          const val = ev.lineItems[li.id];
          const baseVal = baseLookup.lines.get(`${ccCode}|${account.accountCode}|${li.description}`);
          return (
            <tr key={li.id} className="border-t border-border/40">
              <td className="border-r border-border/60" />
              <td className="border-r border-border/60 p-0">
                {renderCell({ id: li.id, field: "description", actual: li.description, className: "pl-5 text-muted", placeholder: "Beskrivning", url: `/api/budgets/line-items/${li.id}`, payload: (v) => ({ description: v }) })}
              </td>
              <td className="border-r border-border/60 p-0 w-24">
                {renderCell({ id: li.id, field: "quantity", actual: li.quantity ?? "", mono: true, className: "text-right", placeholder: "—", url: `/api/budgets/line-items/${li.id}`, payload: (v) => ({ quantity: v }) })}
              </td>
              <td className="border-r border-border/60 p-0 w-28">
                {renderCell({ id: li.id, field: "unitPrice", actual: li.unitPrice ?? "", mono: true, className: "text-right", placeholder: "—", url: `/api/budgets/line-items/${li.id}`, payload: (v) => ({ unitPrice: v }) })}
              </td>
              <td className="p-0 text-right">
                {structured
                  ? <div className="px-2 py-1.5 tabular-nums" title="antal × á-pris">{fmt(val)}</div>
                  : renderCell({ id: li.id, field: "expression", actual: li.expression, mono: true, className: "text-right", placeholder: "0", url: `/api/budgets/line-items/${li.id}`, payload: (v) => ({ expression: v, quantity: "", unitPrice: "" }) })}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted">{fmt(baseVal)}</td>
              <td />
              <td className="px-1 text-center text-muted">
                {isAdmin && <button onClick={() => api(`/api/budgets/line-items/${li.id}`, "DELETE")} className="hover:text-danger" title="Ta bort rad">×</button>}
              </td>
            </tr>
          );
        })}

        {isAdmin && (
          <tr className="border-t border-border/40 bg-background">
            <td className="border-r border-border/60" />
            <td className="border-r border-border/60 p-0">
              <input value={d.description} onChange={(e) => setDraft(account.id, { description: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") createLine(account.id); }}
                placeholder="+ ny rad" className="w-full bg-transparent px-2 py-1.5 pl-5 text-sm text-muted outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
            </td>
            <td className="border-r border-border/60 p-0">
              <input value={d.quantity} onChange={(e) => setDraft(account.id, { quantity: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") createLine(account.id); }}
                placeholder="antal" className="w-full bg-transparent px-2 py-1.5 text-right font-mono text-xs outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
            </td>
            <td className="border-r border-border/60 p-0">
              <input value={d.unitPrice} onChange={(e) => setDraft(account.id, { unitPrice: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") createLine(account.id); }}
                placeholder="á-pris" className="w-full bg-transparent px-2 py-1.5 text-right font-mono text-xs outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
            </td>
            <td className="p-0">
              <input value={d.expression} onChange={(e) => setDraft(account.id, { expression: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") createLine(account.id); }} onBlur={() => createLine(account.id)}
                placeholder="belopp" className="w-full bg-transparent px-2 py-1.5 text-right font-mono text-xs outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
            </td>
            <td /><td /><td />
          </tr>
        )}

        {open && (
          <tr className="bg-surface/20">
            <td colSpan={8} className="px-4 py-3">
              <div className="space-y-2">
                {account.comments.length === 0 && <p className="text-xs text-muted">Inga kommentarer.</p>}
                {account.comments.map((cm) => (
                  <div key={cm.id} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0 font-medium">{cm.author.name}</span>
                    <span className="flex-1 text-muted">{cm.body}</span>
                    {(cm.author.id === userId || isAdmin) && (
                      <button onClick={() => api(`/api/budgets/comments/${cm.id}`, "DELETE")} className="shrink-0 text-xs text-muted hover:text-danger">×</button>
                    )}
                  </div>
                ))}
                {canComment && (
                  <input
                    value={commentDraft[account.id] ?? ""}
                    onChange={(e) => setCommentDraft((m) => ({ ...m, [account.id]: e.target.value }))}
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      const body = (commentDraft[account.id] ?? "").trim();
                      if (!body) return;
                      const ok = await api(`/api/budgets/accounts/${account.id}/comments`, "POST", { body });
                      if (ok) setCommentDraft((m) => ({ ...m, [account.id]: "" }));
                    }}
                    placeholder="Skriv en kommentar…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                  />
                )}
              </div>
            </td>
          </tr>
        )}
      </tbody>
    );
  }

  const numCls = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Summa intäkter", v: totals.income, b: bInc, a: aInc },
          { label: "Summa utgifter", v: totals.cost, b: bCost, a: aCost },
          { label: "Resultat", v: totals.result, b: bInc - bCost, a: aInc - aCost, signed: true },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-background px-4 py-3">
            <p className="text-xs text-muted">{s.label}</p>
            <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", s.signed && (s.v < 0 ? "text-danger" : s.v > 0 ? "text-success" : ""))}>
              {s.signed ? fmtSigned(s.v) : fmt(s.v)}
            </p>
            <p className="text-xs text-muted">{baseName}: {s.signed ? fmtSigned(s.b) : fmt(s.b)}</p>
            <p className="text-xs text-muted">
              Utfall {actualsYear}: {actualsSynced ? (s.signed ? fmtSigned(s.a) : fmt(s.a)) : "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-background">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              <th className="w-24 px-2 py-2">Konto</th>
              <th className="px-2 py-2">Beskrivning</th>
              <th className="w-24 px-2 py-2 text-right">Antal</th>
              <th className="w-28 px-2 py-2 text-right">á-pris</th>
              <th className="w-28 px-2 py-2 text-right">Belopp</th>
              <th className="w-28 px-2 py-2 text-right">{baseName}</th>
              <th className="w-28 px-2 py-2 text-right" title="Bokfört utfall från Fortnox">
                Utfall {actualsYear}
              </th>
              <th className="w-20" />
            </tr>
          </thead>
          <SectionLabel label="Intäkter" total={totals.income} base={bInc} actual={actualsSynced ? aInc : undefined} colSpan={8} />
          {income.map(accountBlock)}
          <SectionLabel label="Kostnader" total={totals.cost} base={bCost} actual={actualsSynced ? aCost : undefined} colSpan={8} />
          {cost.map(accountBlock)}
          <tbody>
            <tr className="border-t-2 border-border bg-surface/60 font-semibold">
              <td className="px-2 py-2" colSpan={4}>Resultat</td>
              <td className={cn(numCls, totals.result < 0 ? "text-danger" : "text-success")}>{fmtSigned(totals.result)}</td>
              <td className={cn(numCls, "text-muted")}>{fmtSigned(bInc - bCost)}</td>
              <td className={cn(numCls, "text-muted")}>{actualsSynced ? fmtSigned(aInc - aCost) : "—"}</td>
              <td />
            </tr>
            {isAdmin && (
              <tr className="border-t border-border bg-background">
                <td className="border-r border-border/60 p-0">
                  <input value={newAccount.code} onChange={(e) => setNewAccount((a) => ({ ...a, code: e.target.value }))}
                    placeholder="+ konto" className="w-full bg-transparent px-2 py-1.5 font-mono text-xs outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
                </td>
                <td className="border-r border-border/60 p-0" colSpan={3}>
                  <input value={newAccount.name} onChange={(e) => setNewAccount((a) => ({ ...a, name: e.target.value }))}
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter" || !newAccount.code.trim()) return;
                      const ok = await api(`/api/budgets/revisions/${revisionId}/cost-centers/${cc.id}/accounts`, "POST", { accountCode: newAccount.code.trim(), accountName: newAccount.name.trim() });
                      if (ok) setNewAccount({ code: "", name: "" });
                    }}
                    placeholder="Kontonamn (3xxx = intäkt) — Enter" className="w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
                </td>
                <td colSpan={4} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionLabel({ label, total, base, actual, colSpan }: { label: string; total: number; base: number; actual?: number; colSpan: number }) {
  return (
    <tbody>
      <tr className="border-b border-border bg-accent-soft/30 text-xs font-semibold uppercase tracking-wide text-accent">
        <td className="px-2 py-1.5" colSpan={colSpan - 4}>{label}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(total)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted">{fmt(base)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted">{actual === undefined ? "—" : fmt(actual)}</td>
        <td />
      </tr>
    </tbody>
  );
}
