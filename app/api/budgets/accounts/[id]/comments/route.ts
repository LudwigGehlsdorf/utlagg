import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor || !["ADMIN", "APPROVER"].includes(actor.role)) {
    return NextResponse.json({ error: "Åtkomst nekad" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const body_ = typeof body.body === "string" ? body.body.trim() : "";
  if (!body_) return NextResponse.json({ error: "Kommentar får inte vara tom" }, { status: 422 });

  const comment = await prisma.budgetComment.create({
    data: { accountId, authorId: actorId, body: body_ },
    include: { author: { select: { id: true, name: true } } },
  });
  return NextResponse.json(comment, { status: 201 });
}
