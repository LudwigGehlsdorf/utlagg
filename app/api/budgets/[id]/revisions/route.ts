import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

// POST /api/budgets/[id]/revisions — clone an existing revision or create blank
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "ADMIN") return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Ny revision";
  const cloneFromId: string | undefined = typeof body.cloneFromId === "string" ? body.cloneFromId : undefined;

  if (!cloneFromId) {
    const revision = await prisma.budgetRevision.create({
      data: { budgetId, name, createdById: actorId },
    });
    return NextResponse.json(revision, { status: 201 });
  }

  // Deep clone the source revision
  const src = await prisma.budgetRevision.findUnique({
    where: { id: cloneFromId },
    include: {
      variables: { orderBy: { sortOrder: "asc" } },
      costCenters: {
        orderBy: { sortOrder: "asc" },
        include: {
          accounts: {
            orderBy: { sortOrder: "asc" },
            include: { lineItems: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
    },
  });
  if (!src || src.budgetId !== budgetId) {
    return NextResponse.json({ error: "Källrevision hittades inte" }, { status: 404 });
  }

  const revision = await prisma.$transaction(async (tx) => {
    const rev = await tx.budgetRevision.create({
      data: { budgetId, name, createdById: actorId, clonedFromId: cloneFromId },
    });
    if (src.variables.length) {
      await tx.budgetVariable.createMany({
        data: src.variables.map((v) => ({
          revisionId: rev.id, name: v.name, expression: v.expression, sortOrder: v.sortOrder,
        })),
      });
    }
    for (const cc of src.costCenters) {
      const newCc = await tx.budgetCostCenter.create({
        data: { revisionId: rev.id, costCenterId: cc.costCenterId, sortOrder: cc.sortOrder },
      });
      for (const acct of cc.accounts) {
        const newAcct = await tx.budgetAccount.create({
          data: { budgetCostCenterId: newCc.id, accountCode: acct.accountCode, accountName: acct.accountName, sortOrder: acct.sortOrder },
        });
        if (acct.lineItems.length) {
          await tx.budgetLineItem.createMany({
            data: acct.lineItems.map((li) => ({
              accountId: newAcct.id, description: li.description, expression: li.expression, sortOrder: li.sortOrder,
            })),
          });
        }
      }
    }
    return rev;
  });

  return NextResponse.json(revision, { status: 201 });
}
