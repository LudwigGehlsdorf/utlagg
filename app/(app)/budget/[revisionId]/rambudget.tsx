// The "Rambudget" overview: every cost centre's income/cost/result, grouped by
// committee with subtotals and a grand total. Rows link into their sheet.
import { cn } from "@/lib/utils";
import { ccTotals, fmt, fmtSigned, OTHER } from "./budget-helpers";
import type { Revision, Evaluated, BudgetCC } from "./budget-types";

const numCls = "px-3 py-1.5 text-right tabular-nums";

export function Rambudget({ revision, ev, onPick }: {
  revision: Revision; ev: Evaluated; onPick: (id: string) => void;
}) {
  const groups: { committee: string; items: BudgetCC[] }[] = [];
  for (const cc of revision.costCenters) {
    const com = cc.costCenter.committee || OTHER;
    let g = groups.find((x) => x.committee === com);
    if (!g) { g = { committee: com, items: [] }; groups.push(g); }
    g.items.push(cc);
  }

  let gInc = 0, gCost = 0;
  for (const cc of revision.costCenters) {
    const t = ccTotals(cc, ev); gInc += t.income; gCost += t.cost;
  }

  return (
    <div className="budget-grid overflow-x-auto rounded-2xl border border-border bg-background">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] text-muted">
            <th className="px-3 py-2 text-left font-medium">Kostnadsställe</th>
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
          </tr>
          {groups.map((g) => {
            let si = 0, sc = 0;
            for (const cc of g.items) {
              const t = ccTotals(cc, ev); si += t.income; sc += t.cost;
            }
            return (
              <FragmentGroup key={g.committee} committee={g.committee} si={si} sc={sc}>
                {g.items.map((cc) => {
                  const t = ccTotals(cc, ev);
                  return (
                    <tr key={cc.id} className="cursor-pointer border-b border-border/50 hover:bg-surface/60" onClick={() => onPick(cc.id)}>
                      <td className="px-3 py-1.5">
                        <span className="font-mono text-xs text-muted">{cc.costCenter.code}</span>{" "}{cc.costCenter.name}
                      </td>
                      <td className={cn("border-l border-border/50", numCls)}>{fmt(t.income)}</td>
                      <td className={numCls}>{fmt(t.cost)}</td>
                      <td className={cn(numCls, t.result < 0 ? "text-danger" : t.result > 0 ? "text-success" : "text-muted")}>{fmtSigned(t.result)}</td>
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

function FragmentGroup({ committee, si, sc, children }: {
  committee: string; si: number; sc: number; children: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-b border-border bg-surface/30">
        <td className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted" colSpan={4}>{committee}</td>
      </tr>
      {children}
      <tr className="border-b border-border text-sm font-medium">
        <td className="px-3 py-1.5 pl-6 text-muted">Totalt {committee.toLowerCase()}</td>
        <td className={cn("border-l border-border/50", numCls)}>{fmt(si)}</td>
        <td className={numCls}>{fmt(sc)}</td>
        <td className={cn(numCls, si - sc < 0 ? "text-danger" : "text-success")}>{fmtSigned(si - sc)}</td>
      </tr>
    </>
  );
}
