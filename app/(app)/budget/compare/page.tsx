"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { formatSEK } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LineItem { id: string; description: string; expression: string; sortOrder: number }
interface Account { id: string; accountCode: string; accountName: string; sortOrder: number; lineItems: LineItem[] }
interface BudgetCC { id: string; sortOrder: number; costCenter: { id: string; code: string; name: string }; accounts: Account[] }
interface Variable { id: string; name: string; expression: string; sortOrder: number }
interface Evaluated { vars: Record<string, number>; accounts: Record<string, number>; lineItems: Record<string, number>; errors: string[] }
interface Revision {
  id: string; name: string;
  variables: Variable[]; costCenters: BudgetCC[]; evaluated: Evaluated;
}

function Diff({ a, b }: { a: number | undefined; b: number | undefined }) {
  const va = a ?? 0, vb = b ?? 0;
  const diff = vb - va;
  if (diff === 0) return <span className="tabular-nums text-muted">—</span>;
  return (
    <span className={cn("tabular-nums", diff > 0 ? "text-success" : "text-danger")}>
      {diff > 0 ? "+" : ""}{formatSEK(diff)}
    </span>
  );
}

function Cell({ value }: { value: number | undefined }) {
  return <span className="tabular-nums">{value !== undefined ? formatSEK(value) : <span className="text-muted/40">—</span>}</span>;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-surface/60">
      <td colSpan={4} className="px-5 py-2 text-xs font-semibold text-muted uppercase tracking-wide">
        {label}
      </td>
    </tr>
  );
}

export default function BudgetComparePage() {
  const params = useSearchParams();
  const idA = params.get("a") ?? "";
  const idB = params.get("b") ?? "";

  const [revA, setRevA] = useState<Revision | null>(null);
  const [revB, setRevB] = useState<Revision | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!idA || !idB) { setLoading(false); return; }
    Promise.all([
      fetch(`/api/budgets/revisions/${idA}`).then((r) => r.json()),
      fetch(`/api/budgets/revisions/${idB}`).then((r) => r.json()),
    ]).then(([a, b]) => {
      setRevA(a); setRevB(b);
    }).finally(() => setLoading(false));
  }, [idA, idB]);

  if (loading) return <div className="py-12 text-center text-sm text-muted">Laddar…</div>;
  if (!revA || !revB) return <div className="py-12 text-center text-sm text-muted">Ogiltiga revisioner.</div>;

  const evA = revA.evaluated, evB = revB.evaluated;

  // Union of variable names
  const allVarNames = Array.from(new Set([
    ...revA.variables.map((v) => v.name),
    ...revB.variables.map((v) => v.name),
  ]));

  // Union of cost centers by CC code
  const allCCCodes = Array.from(new Set([
    ...revA.costCenters.map((c) => c.costCenter.code),
    ...revB.costCenters.map((c) => c.costCenter.code),
  ]));

  const ccByCode = (rev: Revision, code: string) => rev.costCenters.find((c) => c.costCenter.code === code);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Jämför revisioner"
        description={`${revA.name} vs ${revB.name}`}
        action={<ButtonLink href="/budget" variant="secondary" size="sm">← Alla budgetar</ButtonLink>}
      />

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              <th className="px-5 py-3">Rad</th>
              <th className="px-5 py-3 text-right">{revA.name}</th>
              <th className="px-5 py-3 text-right">{revB.name}</th>
              <th className="px-5 py-3 text-right">Differens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">

            {/* Variables */}
            {allVarNames.length > 0 && (
              <>
                <SectionHeader label="Variabler" />
                {allVarNames.map((name) => {
                  const va = evA.vars[name], vb = evB.vars[name];
                  return (
                    <tr key={name} className={cn("hover:bg-surface/20", va !== vb && "bg-warning/5")}>
                      <td className="px-5 py-2 font-mono text-xs font-semibold">{name}</td>
                      <td className="px-5 py-2 text-right"><Cell value={va} /></td>
                      <td className="px-5 py-2 text-right"><Cell value={vb} /></td>
                      <td className="px-5 py-2 text-right"><Diff a={va} b={vb} /></td>
                    </tr>
                  );
                })}
              </>
            )}

            {/* Cost centers */}
            {allCCCodes.map((ccCode) => {
              const ccA = ccByCode(revA, ccCode);
              const ccB = ccByCode(revB, ccCode);
              const ccName = (ccA ?? ccB)!.costCenter.name;

              const ccTotalA = ccA?.accounts.reduce((s, a) => s + (evA.accounts[`${ccCode}:${a.accountCode}`] ?? 0), 0);
              const ccTotalB = ccB?.accounts.reduce((s, a) => s + (evB.accounts[`${ccCode}:${a.accountCode}`] ?? 0), 0);

              // Union of account codes
              const allAcctCodes = Array.from(new Set([
                ...(ccA?.accounts.map((a) => a.accountCode) ?? []),
                ...(ccB?.accounts.map((a) => a.accountCode) ?? []),
              ]));

              const acctByCode = (cc: BudgetCC | undefined, code: string) =>
                cc?.accounts.find((a) => a.accountCode === code);

              return [
                <SectionHeader key={`${ccCode}-hdr`} label={`${ccCode} — ${ccName}`} />,

                // CC total row
                <tr key={`${ccCode}-total`} className="font-semibold">
                  <td className="px-5 py-2">Totalt</td>
                  <td className="px-5 py-2 text-right"><Cell value={ccTotalA} /></td>
                  <td className="px-5 py-2 text-right"><Cell value={ccTotalB} /></td>
                  <td className="px-5 py-2 text-right"><Diff a={ccTotalA} b={ccTotalB} /></td>
                </tr>,

                // Accounts
                ...allAcctCodes.flatMap((acctCode) => {
                  const acctA = acctByCode(ccA, acctCode);
                  const acctB = acctByCode(ccB, acctCode);
                  const acctName = (acctA ?? acctB)!.accountName;
                  const keyA = `${ccCode}:${acctCode}`;
                  const va = evA.accounts[keyA], vb = evB.accounts[keyA];

                  // Union of line item descriptions within this account
                  const allDescs = Array.from(new Set([
                    ...(acctA?.lineItems.map((l) => l.description) ?? []),
                    ...(acctB?.lineItems.map((l) => l.description) ?? []),
                  ]));

                  const liByDesc = (acct: Account | undefined, desc: string) =>
                    acct?.lineItems.find((l) => l.description === desc);

                  return [
                    <tr key={`${acctCode}-hdr`} className={cn("bg-surface/30", va !== vb && "bg-warning/5")}>
                      <td className="px-5 py-2 pl-9">
                        <span className="font-mono text-xs font-semibold text-muted mr-2">{acctCode}</span>
                        {acctName}
                      </td>
                      <td className="px-5 py-2 text-right font-medium"><Cell value={va} /></td>
                      <td className="px-5 py-2 text-right font-medium"><Cell value={vb} /></td>
                      <td className="px-5 py-2 text-right font-medium"><Diff a={va} b={vb} /></td>
                    </tr>,

                    ...allDescs.map((desc) => {
                      const liA = liByDesc(acctA, desc);
                      const liB = liByDesc(acctB, desc);
                      const liVA = liA ? evA.lineItems[liA.id] : undefined;
                      const liVB = liB ? evB.lineItems[liB.id] : undefined;
                      return (
                        <tr key={`${acctCode}-${desc}`} className={cn("hover:bg-surface/20 text-muted", liVA !== liVB && "bg-warning/5")}>
                          <td className="px-5 py-2 pl-14 text-xs">{desc}</td>
                          <td className="px-5 py-2 text-right text-xs"><Cell value={liVA} /></td>
                          <td className="px-5 py-2 text-right text-xs"><Cell value={liVB} /></td>
                          <td className="px-5 py-2 text-right text-xs"><Diff a={liVA} b={liVB} /></td>
                        </tr>
                      );
                    }),
                  ];
                }),
              ];
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
