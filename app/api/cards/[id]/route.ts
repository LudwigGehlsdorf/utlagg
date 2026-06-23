// Assign / unassign a section card's holder. Admin only — the card→member
// registry is the source of truth for whose card purchases show up where.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

// PATCH /api/cards/:id — body: { holderId: string | null }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const actorId = await resolveUserId();
  if (!actorId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (actor?.role !== "ADMIN") {
    return NextResponse.json({ error: "Endast administratör" }, { status: 403 });
  }

  const card = await prisma.card.findUnique({ where: { id } });
  if (!card) {
    return NextResponse.json({ error: "Kortet hittades inte" }, { status: 404 });
  }

  // Empty / null → unassign; otherwise must be an existing user.
  let holderId: string | null = null;
  if (typeof body.holderId === "string" && body.holderId !== "") {
    const user = await prisma.user.findUnique({ where: { id: body.holderId } });
    if (!user) {
      return NextResponse.json({ error: "Okänd användare" }, { status: 422 });
    }
    holderId = user.id;
  }

  await prisma.card.update({ where: { id }, data: { holderId } });
  return NextResponse.json({ ok: true });
}
