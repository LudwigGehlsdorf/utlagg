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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.accountCode === "string" && body.accountCode.trim()) data.accountCode = body.accountCode.trim();
  if (typeof body.accountName === "string" && body.accountName.trim()) data.accountName = body.accountName.trim();
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  // kindOverride: "INCOME" | "COST" sets the override; "" / null clears it
  // (falling back to code-based inference).
  if ("kindOverride" in body) {
    data.kindOverride = body.kindOverride === "INCOME" || body.kindOverride === "COST"
      ? body.kindOverride : null;
  }

  const account = await prisma.budgetAccount.update({ where: { id }, data });
  return NextResponse.json(account);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });
  await prisma.budgetAccount.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
