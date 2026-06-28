import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";
import { evaluate } from "@/lib/budget-eval";
import type { LineItemInput, VariableInput } from "@/lib/budget-eval";
import { EXTRA_COLUMN_KEYS } from "@/lib/budget-grid";
import { effectiveKind } from "@/lib/budget";
import {
  financialYearIdForCalendarYear,
  getActualsByAccountCostCenter,
} from "@/lib/ledger";

export const runtime = "nodejs";

// GET /api/budgets/revisions/[id] — full revision with evaluated values
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const revision = await prisma.budgetRevision.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      clonedFrom: { select: { id: true, name: true } },
      budget: {
        select: { id: true, year: true, name: true, baselineRevisionId: true },
      },
      variables: { orderBy: { sortOrder: "asc" } },
      costCenters: {
        orderBy: { sortOrder: "asc" },
        include: {
          costCenter: true,
          accounts: {
            orderBy: { sortOrder: "asc" },
            include: {
              lineItems: { orderBy: { sortOrder: "asc" } },
              comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, id: true } } } },
            },
          },
        },
      },
    },
  });

  if (!revision) return NextResponse.json({ error: "Revision hittades inte" }, { status: 404 });

  // Build inputs for the evaluator
  const varInputs: VariableInput[] = revision.variables.map((v) => ({ name: v.name, expression: v.expression }));
  const liInputs: LineItemInput[] = revision.costCenters.flatMap((cc) =>
    cc.accounts.flatMap((acct) =>
      acct.lineItems.map((li) => ({
        id: li.id,
        accountKey: `${cc.costCenter.code}:${acct.accountCode}`,
        expression: li.expression,
        values: (li.values ?? {}) as Record<string, string>,
      })),
    ),
  );

  const { vars, accounts, lineItems: liValues, cells, badLineItems, badVariables, errors } = evaluate(varInputs, liInputs, [...EXTRA_COLUMN_KEYS]);

  // Actual outcome from the Fortnox ledger for this budget's calendar year,
  // keyed `${costCenterCode}:${accountCode}` to match the evaluated accounts.
  // Oriented by account kind: income = credit−debit, cost = debit−credit (SEK).
  // Cost centres whose Fortnox code doesn't match an app code simply won't have
  // an entry (left blank in the UI).
  const budgetYear = revision.budget.year;
  const actualsRaw = await getActualsByAccountCostCenter(budgetYear);
  const actualsSynced = (await financialYearIdForCalendarYear(budgetYear)) != null;
  const actuals: Record<string, number> = {};
  for (const cc of revision.costCenters) {
    for (const acct of cc.accounts) {
      const raw = actualsRaw.get(`${cc.costCenter.code}|${acct.accountCode}`);
      if (!raw) continue;
      const kind = effectiveKind(acct.accountCode, acct.kindOverride);
      const net = kind === "INCOME" ? raw.credit - raw.debit : raw.debit - raw.credit;
      actuals[`${cc.costCenter.code}:${acct.accountCode}`] = net / 100; // SEK
    }
  }

  return NextResponse.json({
    ...revision,
    evaluated: {
      vars: Object.fromEntries(vars),
      accounts: Object.fromEntries(accounts),
      lineItems: Object.fromEntries(liValues),
      cells: Object.fromEntries(cells),
      badLineItems,
      badVariables,
      errors,
    },
    actuals,
    actualsSynced,
    actualsYear: budgetYear,
  });
}

// PATCH /api/budgets/revisions/[id] — rename (admin only)
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "ADMIN") return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  if (!name) return NextResponse.json({ error: "Namn krävs" }, { status: 422 });

  const revision = await prisma.budgetRevision.update({ where: { id }, data: { name } });
  return NextResponse.json(revision);
}

// DELETE /api/budgets/revisions/[id] — delete if not the last revision (admin only)
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "ADMIN") return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const revision = await prisma.budgetRevision.findUnique({ where: { id }, select: { budgetId: true } });
  if (!revision) return NextResponse.json({ error: "Revision hittades inte" }, { status: 404 });

  const count = await prisma.budgetRevision.count({ where: { budgetId: revision.budgetId } });
  if (count <= 1) return NextResponse.json({ error: "Kan inte ta bort den enda revisionen" }, { status: 409 });

  await prisma.budgetRevision.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
