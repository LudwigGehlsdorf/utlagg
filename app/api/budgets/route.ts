import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

// GET /api/budgets — list all budgets with their revisions (shallow)
export async function GET() {
  const budgets = await prisma.budget.findMany({
    orderBy: { year: "desc" },
    include: {
      revisions: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, createdAt: true, createdById: true, clonedFromId: true },
      },
    },
  });
  return NextResponse.json(budgets);
}

// POST /api/budgets — create a new budget year (admin only)
export async function POST(req: Request) {
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "ADMIN") return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const year = typeof body.year === "number" ? body.year : new Date().getFullYear();
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim()
    : `Budget ${year}`;
  const revisionName = typeof body.revisionName === "string" && body.revisionName.trim()
    ? body.revisionName.trim()
    : "Ursprunglig";

  const existing = await prisma.budget.findUnique({ where: { year } });
  if (existing) return NextResponse.json({ error: `Budget för ${year} finns redan` }, { status: 409 });

  const budget = await prisma.$transaction(async (tx) => {
    const b = await tx.budget.create({ data: { year, name } });
    await tx.budgetRevision.create({ data: { budgetId: b.id, name: revisionName, createdById: actorId } });
    return b;
  });

  return NextResponse.json(budget, { status: 201 });
}
