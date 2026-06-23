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

export async function POST(req: Request, ctx: { params: Promise<{ id: string; ccid: string }> }) {
  const { ccid: budgetCostCenterId } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const accountCode = typeof body.accountCode === "string" ? body.accountCode.trim() : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  if (!accountCode) return NextResponse.json({ error: "Kontonummer krävs" }, { status: 422 });

  const last = await prisma.budgetAccount.findFirst({ where: { budgetCostCenterId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const account = await prisma.budgetAccount.create({
    data: { budgetCostCenterId, accountCode, accountName, sortOrder: (last?.sortOrder ?? -1) + 1 },
    include: { lineItems: true, comments: true },
  });
  return NextResponse.json(account, { status: 201 });
}
