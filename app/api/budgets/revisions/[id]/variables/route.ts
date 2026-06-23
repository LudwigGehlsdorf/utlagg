import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

async function requireAdmin() {
  const id = await resolveUserId();
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return u?.role === "ADMIN" ? id : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: revisionId } = await ctx.params;
  if (!await requireAdmin()) return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().toUpperCase() : "";
  const expression = typeof body.expression === "string" ? body.expression.trim() : "0";
  if (!name) return NextResponse.json({ error: "Namn krävs" }, { status: 422 });

  const last = await prisma.budgetVariable.findFirst({ where: { revisionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const variable = await prisma.budgetVariable.create({
    data: { revisionId, name, expression, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json(variable, { status: 201 });
}
