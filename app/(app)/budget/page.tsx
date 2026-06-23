"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useRole } from "@/components/role-context";
import { useNotify } from "@/components/notifications";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

interface Revision { id: string; name: string; createdAt: string; clonedFromId: string | null }
interface Budget { id: string; year: number; name: string; revisions: Revision[] }

export default function BudgetListPage() {
  const { role } = useRole();
  const notify = useNotify();
  const confirm = useConfirm();
  const isAdmin = role === "ADMIN";

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));

  async function load() {
    const res = await fetch("/api/budgets");
    if (res.ok) setBudgets(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createBudget() {
    setCreating(true);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(newYear) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        notify.error(data.error ?? "Kunde inte skapa budgeten");
        return;
      }
      notify.success("Budget skapad.");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function cloneRevision(budgetId: string, revisionId: string, revisions: Revision[]) {
    const name = prompt("Namn på ny revision:", `Revision ${revisions.length + 1}`);
    if (!name) return;
    const res = await fetch(`/api/budgets/${budgetId}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cloneFromId: revisionId, name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify.error(data.error ?? "Kunde inte klona revisionen");
      return;
    }
    notify.success("Revision klonad.");
    await load();
  }

  async function deleteRevision(revisionId: string, revisions: Revision[]) {
    if (revisions.length <= 1) {
      notify.error("Kan inte ta bort den enda revisionen.");
      return;
    }
    const ok = await confirm({
      title: "Ta bort revisionen?",
      message: "Revisionen och dess budgetrader tas bort permanent.",
      confirmLabel: "Ta bort",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/budgets/revisions/${revisionId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify.error(data.error ?? "Kunde inte ta bort revisionen");
      return;
    }
    notify.success("Revision borttagen.");
    await load();
  }

  if (loading) return <div className="py-12 text-center text-sm text-muted">Laddar…</div>;

  return (
    <>
      <PageHeader
        title="Budget"
        description="Hantera sektionens budgetar per år."
      />

      {budgets.length === 0 && !isAdmin && (
        <p className="text-sm text-muted">Ingen budget har skapats ännu.</p>
      )}

      <div className="space-y-6">
        {budgets.map((b) => (
          <Card key={b.id}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-semibold">{b.name}</p>
                <p className="text-xs text-muted">{b.year}</p>
              </div>
              {b.revisions.length >= 2 && (
                <ButtonLink
                  href={`/budget/compare?a=${b.revisions[0].id}&b=${b.revisions[b.revisions.length - 1].id}`}
                  variant="secondary"
                  size="sm"
                >
                  Jämför
                </ButtonLink>
              )}
            </div>

            <ul className="divide-y divide-border">
              {b.revisions.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    {r.clonedFromId && (
                      <p className="text-xs text-muted">
                        Klon av {b.revisions.find((x) => x.id === r.clonedFromId)?.name ?? "okänd"}
                      </p>
                    )}
                  </div>
                  <ButtonLink href={`/budget/${r.id}`} size="sm" variant="secondary">
                    Öppna
                  </ButtonLink>
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => cloneRevision(b.id, r.id, b.revisions)}
                      >
                        Klona
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => deleteRevision(r.id, b.revisions)}
                        className={cn(b.revisions.length <= 1 && "opacity-40 pointer-events-none")}
                      >
                        Ta bort
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}

        {isAdmin && (
          <Card>
            <CardBody>
              <p className="mb-3 text-sm font-medium">Skapa ny budget</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  className="h-9 w-28 rounded-lg border border-border bg-background px-3 text-sm focus:border-accent focus:outline-none"
                  placeholder="År"
                />
                <Button onClick={createBudget} disabled={creating}>
                  {creating ? "Skapar…" : "Skapa"}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
