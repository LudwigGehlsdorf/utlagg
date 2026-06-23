"use client";

import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { ExpenseList } from "@/components/expense-list";
import { EmptyState } from "@/components/ui/empty-state";
import { useRole } from "@/components/role-context";
import { useData } from "@/components/data-context";
import { formatSEK } from "@/lib/format";
import { IconPlus } from "@/components/ui/icons";
import type { Expense } from "@/lib/types";

export default function DashboardPage() {
  const { role, user } = useRole();
  const { expenses, bankTransactions } = useData();

  const mine = expenses.filter((e) => e.submitterName === user.name);
  const pendingApproval = expenses.filter((e) => e.status === "PENDING_APPROVAL");
  const approved = expenses.filter((e) => e.status === "APPROVED");
  const booked = expenses.filter((e) => e.status === "BOOKED");
  const unmatched = bankTransactions.filter(
    (t) => !t.matchedExpenseId && t.amount < 0,
  );

  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Hej ${firstName}`}
        description="Här är en överblick av sektionens ekonomi."
        action={
          <ButtonLink href="/expenses/new">
            <IconPlus className="size-4" />
            Nytt utlägg
          </ButtonLink>
        }
      />

      {role === "MEMBER" && (
        <Section>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Mina utlägg" value={String(mine.length)} />
            <StatCard
              label="Väntar på attest"
              value={String(mine.filter((e) => e.status === "PENDING_APPROVAL").length)}
            />
            <StatCard
              label="Behöver ändras"
              value={String(mine.filter((e) => e.status === "CHANGES_REQUESTED").length)}
              accent
            />
            <StatCard
              label="Totalt i år"
              value={formatSEK(mine.reduce((s, e) => s + e.grossAmount, 0))}
            />
          </div>
          <ListBlock title="Mina senaste utlägg" expenses={mine} />
        </Section>
      )}

      {role === "APPROVER" && (
        <Section>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard label="Att attestera" value={String(pendingApproval.length)} accent />
            <StatCard
              label="Att attestera, belopp"
              value={formatSEK(pendingApproval.reduce((s, e) => s + e.grossAmount, 0))}
            />
            <StatCard label="Mina utlägg" value={String(mine.length)} />
          </div>
          <ListBlock title="Väntar på din attest" expenses={pendingApproval} />
        </Section>
      )}

      {(role === "BOOKKEEPER" || role === "ADMIN") && (
        <Section>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Att bokföra" value={String(approved.length)} accent />
            <StatCard label="Att exportera" value={String(booked.length)} />
            <StatCard label="Omatchade transaktioner" value={String(unmatched.length)} />
            <StatCard label="Väntar på attest" value={String(pendingApproval.length)} />
          </div>
          <ListBlock title="Klart för bokföring" expenses={approved} />
        </Section>
      )}
    </>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}

function ListBlock({ title, expenses }: { title: string; expenses: Expense[] }) {
  return (
    <div>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {expenses.length ? (
        <ExpenseList expenses={expenses} />
      ) : (
        <EmptyState title="Inget här just nu" description="Allt är hanterat." />
      )}
    </div>
  );
}
