import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const comment = await prisma.budgetComment.findUnique({ where: { id }, select: { authorId: true } });
  if (!comment) return NextResponse.json({ error: "Kommentar hittades inte" }, { status: 404 });

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (comment.authorId !== actorId && actor?.role !== "ADMIN") {
    return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });
  }

  await prisma.budgetComment.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
