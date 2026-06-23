import Link from "next/link";
import { PAYMENT_META } from "@/lib/status";
import { formatDate, formatSEK } from "@/lib/format";
import type { Expense } from "@/lib/types";
import { StatusPill, Tag } from "./ui/status-pill";
import { IconChevronRight } from "./ui/icons";

export function ExpenseList({ expenses }: { expenses: Expense[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-[var(--shadow-card)]">
      {/* Header row (desktop only) */}
      <div className="hidden grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border px-5 py-3 text-xs font-medium text-muted md:grid">
        <span>Utlägg</span>
        <span className="w-40">Status</span>
        <span className="w-28 text-right">Belopp</span>
        <span className="w-5" />
      </div>

      <ul>
        {expenses.map((e) => (
          <li key={e.id} className="border-b border-border last:border-0">
            <Link
              href={`/expenses/${e.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <Tag>{PAYMENT_META[e.paymentType].label}</Tag>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {e.id} · {e.submitterName} · {e.allocations.map((a) => a.costCenterCode).join(", ")} ·{" "}
                  {formatDate(e.purchaseDate)}
                </p>
              </div>

              <div className="hidden w-40 md:block">
                <StatusPill status={e.status} />
              </div>

              <div className="w-28 text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {formatSEK(e.grossAmount)}
                </p>
                <p className="mt-0.5 text-xs text-muted md:hidden">
                  {e.merchant}
                </p>
              </div>

              <IconChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
