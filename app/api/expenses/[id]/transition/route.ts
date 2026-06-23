// Drive an utlägg through its lifecycle. One endpoint, validated state machine.
// Booking is separate (/book) because it creates a verification.
// [id] param is the human reference.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";
import type { ExpenseStatus } from "@/lib/generated/prisma/client";

// Note: export (BOOKED → EXPORTED) is NOT here — it's a real Fortnox API call,
// handled by app/api/expenses/[id]/export/route.ts.
type SimpleAction = "submit" | "request_changes";

const SIMPLE_TRANSITIONS: Record<
  SimpleAction,
  { from: ExpenseStatus[]; to: ExpenseStatus; event: string; requireComment?: boolean }
> = {
  submit: {
    from: ["DRAFT", "PENDING_MATCH", "CHANGES_REQUESTED"],
    to: "PENDING_APPROVAL",
    event: "SUBMITTED",
  },
  request_changes: {
    from: ["PENDING_APPROVAL"],
    to: "CHANGES_REQUESTED",
    event: "CHANGES_REQUESTED",
    requireComment: true,
  },
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: reference } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action: string = body.action;
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  const actorId = await resolveUserId();
  if (!actorId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const expense = await prisma.expense.findUnique({
    where: { reference },
    include: {
      allocations: { include: { costCenter: true } },
    },
  });
  if (!expense) {
    return NextResponse.json({ error: "Utlägget hittades inte" }, { status: 404 });
  }

  // ── Approve: partial per-cost-centre approval ─────────────────────────────
  if (action === "approve") {
    if (expense.status !== "PENDING_APPROVAL") {
      return NextResponse.json(
        { error: `Kan inte attestera från status ${expense.status}` },
        { status: 409 },
      );
    }

    // Find allocations where the acting user is the designated approver and
    // haven't been approved yet.
    const mine = expense.allocations.filter(
      (a) => a.costCenter.approverId === actorId && !a.approvedById,
    );
    if (mine.length === 0) {
      return NextResponse.json(
        { error: "Inga kostnadsställen att attestera för din del" },
        { status: 403 },
      );
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Stamp each of the actor's pending allocations as approved.
      await tx.expenseCostAllocation.updateMany({
        where: { id: { in: mine.map((a) => a.id) } },
        data: { approvedById: actorId, approvedAt: now },
      });

      // Reload to check if ALL allocations are now approved.
      const remaining = await tx.expenseCostAllocation.count({
        where: { expenseId: expense.id, approvedById: null },
      });

      await tx.expenseEvent.create({
        data: { expenseId: expense.id, type: "COST_CENTER_APPROVED", actorId },
      });
      if (remaining === 0) {
        await tx.expense.update({
          where: { id: expense.id },
          data: { status: "APPROVED" },
        });
      }
    });

    const updated = await prisma.expense.findUnique({
      where: { id: expense.id },
      select: { status: true },
    });
    return NextResponse.json({ ok: true, reference, status: updated?.status });
  }

  // ── Simple state-machine transitions ──────────────────────────────────────
  const rule = SIMPLE_TRANSITIONS[action as SimpleAction];
  if (!rule) {
    return NextResponse.json({ error: "Okänd åtgärd" }, { status: 400 });
  }
  if (!rule.from.includes(expense.status)) {
    return NextResponse.json(
      { error: `Åtgärden går inte från status ${expense.status}` },
      { status: 409 },
    );
  }
  if (action === "submit") {
    if (expense.paymentType === "CARD" && !expense.matchedTransactionId) {
      return NextResponse.json(
        { error: "Kortköp måste matchas mot en banktransaktion innan de skickas in för attest" },
        { status: 422 },
      );
    }
    if (expense.allocations.length === 0) {
      return NextResponse.json(
        { error: "Minst ett kostnadsställe krävs innan utlägget kan skickas in" },
        { status: 422 },
      );
    }
    const allocSum = expense.allocations.reduce((s, a) => s + a.amount, 0);
    if (expense.grossAmount !== null && allocSum !== expense.grossAmount) {
      return NextResponse.json(
        { error: "Kostnadsfördelningen måste summera till totalt belopp" },
        { status: 422 },
      );
    }
  }
  if (rule.requireComment && !comment) {
    return NextResponse.json({ error: "En kommentar krävs" }, { status: 422 });
  }

  await prisma.$transaction(async (tx) => {
    // Clear allocation approvals when going back to editable state.
    if (rule.to === "CHANGES_REQUESTED") {
      await tx.expenseCostAllocation.updateMany({
        where: { expenseId: expense.id },
        data: { approvedById: null, approvedAt: null },
      });
    }
    await tx.expense.update({ where: { id: expense.id }, data: { status: rule.to } });
    await tx.expenseEvent.create({
      data: {
        expenseId: expense.id,
        type: rule.event as Parameters<typeof tx.expenseEvent.create>[0]["data"]["type"],
        actorId,
        comment: comment || null,
      },
    });
  });

  return NextResponse.json({ ok: true, reference, status: rule.to });
}
