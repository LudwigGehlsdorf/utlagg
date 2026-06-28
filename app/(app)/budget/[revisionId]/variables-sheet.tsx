// The "Variabler" sheet: named values/expressions referenceable from any cell.
import { cn } from "@/lib/utils";
import { fmt } from "./budget-helpers";
import type { Revision, Evaluated, CellFn, FormulaFn, ApiFn } from "./budget-types";

export function VariablesSheet({ revision, ev, isAdmin, renderCell, renderFormula, api, newVar, setNewVar, revisionId }: {
  revision: Revision; ev: Evaluated;
  isAdmin: boolean; renderCell: CellFn; renderFormula: FormulaFn; api: ApiFn;
  newVar: string; setNewVar: (v: string) => void; revisionId: string;
}) {
  return (
    <div className="budget-grid overflow-hidden rounded-2xl border border-border bg-background">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted">
            <th className="w-52 px-3 py-2">Variabel</th>
            <th className="px-3 py-2">Uttryck</th>
            <th className="w-28 px-3 py-2 text-right">Värde</th>
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
                {renderFormula({ id: v.id, field: "expression", raw: v.expression, computed: ev.vars[v.name], sheet: "", display: "formula", bad: ev.badVariables?.includes(v.name), url: `/api/budgets/variables/${v.id}`, payload: (x) => ({ expression: x }) })}
              </td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums", ev.badVariables?.includes(v.name) && "text-danger")}>{fmt(ev.vars[v.name])}</td>
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
              <td />{isAdmin && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
