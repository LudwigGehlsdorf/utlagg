import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

// DELETE /api/bank/:id — bookkeeper/admin only. Refuses if the transaction is
// matched to an expense (caller must unmatch first).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (actor?.role !== "BOOKKEEPER" && actor?.role !== "ADMIN") {
    return NextResponse.json({ error: "Saknar behörighet" }, { status: 403 });
  }

  const txn = await prisma.bankTransaction.findUnique({
    where: { id },
    include: { matchedExpense: { select: { reference: true } } },
  });
  if (!txn) return NextResponse.json({ error: "Hittades inte" }, { status: 404 });

  if (txn.matchedExpense) {
    return NextResponse.json(
      { error: `Transaktionen är matchad mot ${txn.matchedExpense.reference} — ta bort matchningen först` },
      { status: 409 },
    );
  }

  await prisma.bankTransaction.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
