// The budget cell-editing layer: the read-only-until-edit input renderers
// (text / formula / auto), the buffered-edit + focus + edit-mode state, and the
// optimistic commit path (apply locally, re-evaluate on the client, PATCH in the
// background). Returned to the revision client and threaded into the sheets.
import { useState } from "react";
import { toStored, toDisplay, EXTRA_COLUMN_KEYS, type BudgetGrid } from "@/lib/budget-grid";
import { evaluate } from "@/lib/budget-eval";
import { cn } from "@/lib/utils";
import { autoNumber, fmt } from "./budget-helpers";
import type { Revision, Evaluated, ApiFn, CellArgs, FormulaArgs, AutoArgs, CellFn, FormulaFn, AutoFn } from "./budget-types";

interface Opts {
  grid: BudgetGrid;
  isAdmin: boolean;
  revision: Revision | null;
  setRevision: React.Dispatch<React.SetStateAction<Revision | null>>;
  notify: { error: (msg: string) => void };
  load: () => Promise<void>;
  api: ApiFn;
}

export function useBudgetCells({ grid, isAdmin, revision, setRevision, notify, load, api }: Opts) {
  // Buffered in-progress cell edits, keyed `${id}:${field}`.
  const [pending, setPending] = useState<Record<string, string>>({});
  // Which formula cell is currently focused (shows the formula instead of the value).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Spreadsheet edit mode: budget cells are read-only (navigable) until Enter.
  const [editing, setEditing] = useState(false);

  const pVal = (id: string, field: string, actual: string) => pending[`${id}:${field}`] ?? actual;
  const setP = (id: string, field: string, v: string) => setPending((p) => ({ ...p, [`${id}:${field}`]: v }));
  const clearP = (id: string, field: string) => setPending((p) => { const n = { ...p }; delete n[`${id}:${field}`]; return n; });

  // ── Optimistic field edits ───────────────────────────────────────
  // A cell edit shouldn't refetch (and re-evaluate) the whole revision — that's
  // a PATCH plus two GETs per keystroke-commit. Instead we apply the change to
  // local state, re-run the evaluator on the client (same `evaluate` the server
  // uses), and fire the PATCH in the background, only reloading if it fails.

  // Re-derive `evaluated` from the revision's own data (actuals are untouched).
  function recompute(rev: Revision): Revision {
    const varInputs = rev.variables.map((v) => ({ name: v.name, expression: v.expression }));
    const liInputs = rev.costCenters.flatMap((cc) =>
      cc.accounts.flatMap((a) =>
        a.lineItems.map((li) => ({ id: li.id, accountKey: `${cc.costCenter.code}:${a.accountCode}`, expression: li.expression, values: li.values })),
      ),
    );
    const r = evaluate(varInputs, liInputs, [...EXTRA_COLUMN_KEYS]);
    const evaluated: Evaluated = {
      vars: Object.fromEntries(r.vars), accounts: Object.fromEntries(r.accounts),
      lineItems: Object.fromEntries(r.lineItems), cells: Object.fromEntries(r.cells),
      badLineItems: r.badLineItems, badVariables: r.badVariables, errors: r.errors,
    };
    return { ...rev, evaluated };
  }

  // Merge a columnValues patch the same way the server does (empty clears).
  function mergeValues(cur: Record<string, string>, patch: Record<string, string>): Record<string, string> {
    const merged = { ...(cur ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== "string") continue;
      if (v.trim() === "") delete merged[k]; else merged[k] = v.trim();
    }
    return merged;
  }

  // Apply a PATCH payload to local state by URL shape; null = not a known field edit.
  function applyLocal(rev: Revision, url: string, payload: Record<string, unknown>): Revision | null {
    const str = (k: string, fallback: string) => (typeof payload[k] === "string" ? (payload[k] as string) : fallback);
    let m: RegExpMatchArray | null;
    if ((m = url.match(/\/line-items\/([^/]+)$/))) {
      const id = m[1];
      return { ...rev, costCenters: rev.costCenters.map((cc) => ({ ...cc, accounts: cc.accounts.map((a) => ({ ...a,
        lineItems: a.lineItems.map((li) => li.id !== id ? li : {
          ...li,
          description: str("description", li.description),
          expression: str("expression", li.expression),
          values: payload.columnValues && typeof payload.columnValues === "object" ? mergeValues(li.values, payload.columnValues as Record<string, string>) : li.values,
        }) })) })) };
    }
    if ((m = url.match(/\/accounts\/([^/]+)$/))) {
      const id = m[1];
      return { ...rev, costCenters: rev.costCenters.map((cc) => ({ ...cc, accounts: cc.accounts.map((a) => a.id !== id ? a : {
        ...a, accountCode: str("accountCode", a.accountCode), accountName: str("accountName", a.accountName),
      }) })) };
    }
    if ((m = url.match(/\/variables\/([^/]+)$/))) {
      const id = m[1];
      return { ...rev, variables: rev.variables.map((v) => v.id !== id ? v : { ...v, name: str("name", v.name), expression: str("expression", v.expression) }) };
    }
    return null;
  }

  async function commitField(url: string, payload: Record<string, unknown>) {
    const next = revision && applyLocal(revision, url, payload);
    if (!next) return void api(url, "PATCH", payload); // unknown shape → reload path
    setRevision(recompute(next));
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: "" }));
      notify.error(msg || `Fel (${res.status})`);
      await load(); // resync on failure
    }
  }

  async function commit(id: string, field: string, actual: string, url: string, payload: (v: string) => Record<string, unknown>) {
    const key = `${id}:${field}`;
    const v = pending[key];
    if (v === undefined || v.trim() === actual.trim()) { clearP(id, field); return; }
    clearP(id, field);
    await commitField(url, payload(v.trim()));
  }

  // Commit a formula cell: turn the typed A1 form back into stored row-bound
  // tokens, then PATCH if it actually changed.
  async function commitFormula(id: string, field: string, raw: string, sheet: string, url: string, payload: (v: string) => Record<string, unknown>) {
    const key = `${id}:${field}`;
    setFocusKey((k) => (k === key ? null : k));
    const typed = pending[key];
    if (typed === undefined) return;
    const stored = toStored(typed, sheet, grid);
    clearP(id, field);
    if (stored.trim() === raw.trim()) return;
    await commitField(url, payload(stored));
  }

  // An editable text cell (admin only); otherwise a static value. Invoked as a
  // plain function (not <Cell/>) so the <input> reconciles by position and keeps
  // focus across re-renders instead of remounting on every keystroke.
  const renderCell: CellFn = ({ id, field, actual, className, placeholder, mono, url, payload, gated }: CellArgs) => {
    if (!isAdmin) {
      return <div className={cn("px-2 py-1.5 min-h-8", mono && "font-mono text-xs", className)}>{actual || <span className="text-muted/40">{placeholder}</span>}</div>;
    }
    return (
      <input
        data-cell={gated ? `${id}:${field}` : undefined}
        value={pVal(id, field, actual)}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commit(id, field, actual, url, payload)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") clearP(id, field); }}
        placeholder={placeholder}
        className={cn("w-full bg-transparent px-2 py-1.5 outline-none", mono && "font-mono text-xs", className)}
      />
    );
  };

  // A spreadsheet-style cell: shows the evaluated value when idle, the formula
  // (in A1 form, with a leading "=") while focused. `raw` is the stored string,
  // `computed` the evaluated number, `sheet` the cost-centre code for ref scope.
  const renderFormula: FormulaFn = ({ id, field, raw, computed, sheet, bad, placeholder, url, payload, className, display = "value", gated }: FormulaArgs) => {
    const key = `${id}:${field}`;
    const focused = focusKey === key;
    const empty = raw.trim() === "";
    const isFormula = raw.trim().startsWith("=");
    const formulaText = toDisplay(raw, sheet, grid);
    const asFormula = display === "formula" || focused;
    const idle = empty ? (placeholder ?? "") : display === "formula" ? (formulaText || raw) : (bad ? "fel" : fmt(computed));
    if (!isAdmin) {
      return <div className={cn("px-2 py-1.5 min-h-8", display === "formula" ? "font-mono text-xs" : "text-right tabular-nums", empty && "text-muted/40", bad && !empty && "text-danger", className)} title={isFormula ? formulaText : undefined}>{idle}</div>;
    }
    return (
      <input
        data-cell={gated ? key : undefined}
        value={focused ? (pending[key] ?? formulaText) : empty ? "" : idle}
        placeholder={placeholder}
        title={isFormula && !focused ? formulaText : undefined}
        onFocus={(e) => { setFocusKey(key); if (pending[key] === undefined) setP(id, field, formulaText); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commitFormula(id, field, raw, sheet, url, payload)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { clearP(id, field); setFocusKey(null); } }}
        className={cn(
          "w-full bg-transparent px-2 py-1.5 outline-none placeholder:text-muted/40",
          asFormula ? "font-mono text-xs" : "text-right tabular-nums",
          !asFormula && isFormula && "bg-accent-soft/30",
          bad && !empty && "text-danger",
          className,
        )}
      />
    );
  };

  // A general (x1…x6) cell: auto-typed. A formula ("=…") shows its evaluated
  // value when idle; a number/percentage is shown as typed and right-aligned
  // (and is referenceable); anything else is free text, left-aligned.
  const renderAuto: AutoFn = ({ id, field, raw, computed, sheet, placeholder, url, payload, gated }: AutoArgs) => {
    const key = `${id}:${field}`;
    const focused = focusKey === key;
    const trimmed = raw.trim();
    const empty = trimmed === "";
    const isFormula = trimmed.startsWith("=");
    const isText = !empty && !isFormula && autoNumber(trimmed) === null;
    const formulaText = toDisplay(raw, sheet, grid);
    const idle = empty ? (placeholder ?? "") : isFormula ? fmt(computed) : raw;
    const alignCls = isText ? "text-left" : "text-right tabular-nums";
    if (!isAdmin) {
      return <div className={cn("px-2 py-1.5 min-h-8", alignCls, empty && "text-muted/40")} title={isFormula ? formulaText : undefined}>{idle}</div>;
    }
    return (
      <input
        data-cell={gated ? key : undefined}
        value={focused ? (pending[key] ?? formulaText) : empty ? "" : idle}
        placeholder={placeholder}
        title={isFormula && !focused ? formulaText : undefined}
        onFocus={(e) => { setFocusKey(key); if (pending[key] === undefined) setP(id, field, formulaText); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setP(id, field, e.target.value)}
        onBlur={() => commitFormula(id, field, raw, sheet, url, payload)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { clearP(id, field); setFocusKey(null); } }}
        className={cn("w-full bg-transparent px-2 py-1.5 outline-none placeholder:text-muted/40", alignCls, focused && isFormula && "font-mono text-xs")}
      />
    );
  };

  return { renderCell, renderFormula, renderAuto, editing, setEditing };
}
