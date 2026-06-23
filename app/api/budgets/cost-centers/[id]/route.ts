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

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });
  await prisma.budgetCostCenter.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
