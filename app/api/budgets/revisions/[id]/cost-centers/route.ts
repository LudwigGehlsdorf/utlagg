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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: revisionId } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const costCenterId = typeof body.costCenterId === "string" ? body.costCenterId : null;
  if (!costCenterId) return NextResponse.json({ error: "costCenterId krävs" }, { status: 422 });

  const last = await prisma.budgetCostCenter.findFirst({ where: { revisionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const cc = await prisma.budgetCostCenter.create({
    data: { revisionId, costCenterId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    include: { costCenter: true },
  });
  return NextResponse.json(cc, { status: 201 });
}
