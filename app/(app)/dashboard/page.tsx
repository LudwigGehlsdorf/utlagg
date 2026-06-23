import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { StatRow } from "@/components/stat-row";
import { ExpenseList } from "@/components/expense-list";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveSessionUser } from "@/lib/current-user";
import { getBankTransactions, getExpenseSummaries } from "@/lib/data";
import { formatSEK } from "@/lib/format";
import { IconPlus } from "@/components/ui/icons";
import type { Expense } from "@/lib/types";

export default async function DashboardPage() {
  const user = await resolveSessionUser();
  if (!user) redirect("/login");
  const { role } = user;
  const [expenses, bankTransactions] = await Promise.all([
    getExpenseSummaries(),
    getBankTransactions(),
  ]);

  const mine = expenses.filter((e) => e.submitterName === user.name);
  const pendingApproval = expenses.filter((e) => e.status === "PENDING_APPROVAL");
  const approved = expenses.filter((e) => e.status === "APPROVED");
  const booked = expenses.filter((e) => e.status === "BOOKED");
  const unmatched = bankTransactions.filter(
    (t) => !t.matchedExpenseId && t.amount < 0,
  );

  const firstName = user.name.split(" ")[0];

  return (
    <PageShell
      title={`Hej ${firstName}`}
      description="Här är en överblick av sektionens ekonomi."
      action={
        <ButtonLink href="/expenses/new">
          <IconPlus className="size-4" />
          Nytt utlägg
        </ButtonLink>
      }
    >
      {role === "MEMBER" && (
        <Section>
          <StatRow>
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
          </StatRow>
          <ListBlock title="Mina senaste utlägg" expenses={mine} />
        </Section>
      )}

      {role === "APPROVER" && (
        <Section>
          <StatRow>
            <StatCard label="Att attestera" value={String(pendingApproval.length)} accent />
            <StatCard
              label="Att attestera, belopp"
              value={formatSEK(pendingApproval.reduce((s, e) => s + e.grossAmount, 0))}
            />
            <StatCard label="Mina utlägg" value={String(mine.length)} />
          </StatRow>
          <ListBlock title="Väntar på din attest" expenses={pendingApproval} />
        </Section>
      )}

      {(role === "BOOKKEEPER" || role === "ADMIN") && (
        <Section>
          <StatRow>
            <StatCard label="Att bokföra" value={String(approved.length)} accent />
            <StatCard label="Att exportera" value={String(booked.length)} />
            <StatCard label="Omatchade transaktioner" value={String(unmatched.length)} />
            <StatCard label="Väntar på attest" value={String(pendingApproval.length)} />
          </StatRow>
          <ListBlock title="Klart för bokföring" expenses={approved} />
        </Section>
      )}
    </PageShell>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
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
