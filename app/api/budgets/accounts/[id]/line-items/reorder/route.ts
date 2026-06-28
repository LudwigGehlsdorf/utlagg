import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

async function requireAdmin() {
  const id = await resolveUserId();
  if (!id) return false;
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return u?.role === "ADMIN";
}

// POST /api/budgets/accounts/[id]/line-items/reorder — reassign sortOrder to the
// given order (admin). Ignores ids that don't belong to this account.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  if (!(await requireAdmin())) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds.filter((x: unknown) => typeof x === "string") : [];
  if (orderedIds.length === 0) return NextResponse.json({ error: "orderedIds krävs" }, { status: 422 });

  const own = await prisma.budgetLineItem.findMany({ where: { accountId }, select: { id: true } });
  const valid = new Set(own.map((o) => o.id));
  const ids = orderedIds.filter((id) => valid.has(id));

  await prisma.$transaction(ids.map((id, i) => prisma.budgetLineItem.update({ where: { id }, data: { sortOrder: i } })));
  return NextResponse.json({ ok: true });
}
