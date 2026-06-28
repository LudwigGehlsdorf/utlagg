// Create a DRAFT expense. The upload wizard calls this first so it has an
// expense to attach the receipt to (Receipt.expenseId is required).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

// POST /api/expenses — body: { paymentType?, title?, matchedTransactionId? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const paymentType = body.paymentType === "REIMBURSEMENT" ? "REIMBURSEMENT" : "CARD";
  const title: string = typeof body.title === "string" ? body.title : "";
  const matchedTransactionId =
    typeof body.matchedTransactionId === "string" ? body.matchedTransactionId : null;

  const submitterId = await resolveUserId();
  if (!submitterId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  // A card purchase ("Sektionskort") is only available to members who hold a card.
  if (paymentType === "CARD") {
    const holds = await prisma.card.count({ where: { holderId: submitterId } });
    if (holds === 0) {
      return NextResponse.json({ error: "Du har inget sektionskort" }, { status: 403 });
    }
  }

  // Optional pre-match to a bank transaction (from the "Redovisa" deep-link).
  if (matchedTransactionId) {
    const txn = await prisma.bankTransaction.findUnique({
      where: { id: matchedTransactionId },
      include: { matchedExpense: { select: { id: true } }, card: { select: { holderId: true } } },
    });
    if (!txn) {
      return NextResponse.json({ error: "Transaktionen finns inte" }, { status: 422 });
    }
    if (txn.matchedExpense) {
      return NextResponse.json(
        { error: "Transaktionen är redan kopplad till ett utlägg" },
        { status: 409 },
      );
    }
    // You can only match a purchase made with your own section card.
    if (txn.card?.holderId !== submitterId) {
      return NextResponse.json(
        { error: "Transaktionen tillhör inte ditt sektionskort" },
        { status: 403 },
      );
    }
  }

  const expense = await prisma.$transaction(async (tx) => {
    const prefix = `U-${new Date().getFullYear()}-`;
    const last = await tx.expense.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: "desc" },
      select: { reference: true },
    });
    const nextNum = last ? parseInt(last.reference.slice(prefix.length), 10) + 1 : 1;
    const reference = `${prefix}${String(nextNum).padStart(4, "0")}`;

    const created = await tx.expense.create({
      data: { reference, title, submitterId, paymentType, status: "DRAFT", matchedTransactionId },
    });
    await tx.expenseEvent.create({
      data: { expenseId: created.id, type: "CREATED", actorId: submitterId },
    });
    if (matchedTransactionId) {
      await tx.expenseEvent.create({
        data: { expenseId: created.id, type: "MATCHED", actorId: submitterId },
      });
    }
    return created;
  });

  return NextResponse.json(
    { id: expense.id, reference: expense.reference },
    { status: 201 },
  );
}
