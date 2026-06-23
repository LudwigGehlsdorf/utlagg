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
  const { id: accountId } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const expression = typeof body.expression === "string" ? body.expression.trim() : "0";
  const quantity = typeof body.quantity === "string" && body.quantity.trim() ? body.quantity.trim() : null;
  const unitPrice = typeof body.unitPrice === "string" && body.unitPrice.trim() ? body.unitPrice.trim() : null;
  if (!description && !expression && !(quantity && unitPrice)) {
    return NextResponse.json({ error: "Beskrivning eller formel krävs" }, { status: 422 });
  }

  const last = await prisma.budgetLineItem.findFirst({ where: { accountId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const item = await prisma.budgetLineItem.create({
    data: { accountId, description, expression, quantity, unitPrice, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json(item, { status: 201 });
}
