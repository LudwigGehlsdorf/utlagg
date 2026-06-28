// Set or clear the bank-transaction match on a CARD expense. Only allowed
// while the expense is still pre-submission (DRAFT / PENDING_MATCH /
// CHANGES_REQUESTED). The [id] param is the human reference.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

const MATCHABLE_STATUSES = ["DRAFT", "PENDING_MATCH", "CHANGES_REQUESTED"] as const;

// POST /api/expenses/:id/match
// body: { transactionId: string }  → match
// body: { transactionId: null }    → unmatch
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: reference } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const actorId = await resolveUserId();
  if (!actorId) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  const expense = await prisma.expense.findUnique({ where: { reference } });
  if (!expense) return NextResponse.json({ error: "Utlägget hittades inte" }, { status: 404 });

  const isOwner = actor?.id === expense.submitterId;
  const isAdmin = actor?.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Saknar behörighet" }, { status: 403 });
  }
  if (!MATCHABLE_STATUSES.includes(expense.status as typeof MATCHABLE_STATUSES[number])) {
    return NextResponse.json(
      { error: "Matchning kan bara ändras på utlägg som inte skickats in" },
      { status: 409 },
    );
  }
  if (expense.paymentType !== "CARD") {
    return NextResponse.json(
      { error: "Bara kortköp kan matchas mot banktransaktioner" },
      { status: 422 },
    );
  }

  const transactionId =
    body.transactionId === null || body.transactionId === ""
      ? null
      : typeof body.transactionId === "string"
        ? body.transactionId
        : undefined;

  if (transactionId === undefined) {
    return NextResponse.json({ error: "transactionId krävs" }, { status: 422 });
  }

  if (transactionId !== null) {
    // Validate the transaction exists, belongs to the submitter's own section
    // card, and isn't already taken by another expense.
    const txn = await prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      include: { matchedExpense: { select: { reference: true } }, card: { select: { holderId: true } } },
    });
    if (!txn) {
      return NextResponse.json({ error: "Transaktionen finns inte" }, { status: 422 });
    }
    if (txn.card?.holderId !== expense.submitterId) {
      return NextResponse.json(
        { error: "Transaktionen tillhör inte utläggets sektionskort" },
        { status: 403 },
      );
    }
    if (txn.matchedExpense && txn.matchedExpense.reference !== reference) {
      return NextResponse.json(
        { error: `Transaktionen är redan kopplad till ${txn.matchedExpense.reference}` },
        { status: 409 },
      );
    }
  }

  const eventType = transactionId ? "MATCHED" : "UNMATCHED";

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expense.id },
      data: { matchedTransactionId: transactionId },
    });
    await tx.expenseEvent.create({
      data: { expenseId: expense.id, type: eventType, actorId },
    });
  });

  return NextResponse.json({ ok: true });
}
