// Edit an utlägg. Only allowed before signing (see EDITABLE_STATUSES). Records
// an EDITED event with a structured diff + human summary. [id] = human reference.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";
import { deleteObject } from "@/lib/storage";
import { isEditable, isSigned } from "@/lib/status";

export const runtime = "nodejs";

const FIELD_LABELS: Record<string, string> = {
  title: "Beskrivning",
  merchant: "Butik",
  purchaseDate: "Inköpsdatum",
  grossAmount: "Belopp",
  allocations: "Kostnadsfördelning",
  paymentType: "Betalsätt",
};

const toOre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: reference } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const expense = await prisma.expense.findUnique({
    where: { reference },
    include: {
      allocations: { include: { costCenter: true } },
    },
  });
  if (!expense) {
    return NextResponse.json({ error: "Utlägget hittades inte" }, { status: 404 });
  }
  if (!isEditable(expense.status)) {
    return NextResponse.json(
      { error: `Utlägg med status ${expense.status} kan inte redigeras` },
      { status: 409 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : expense.title;
  if (!title) {
    return NextResponse.json({ error: "Beskrivning krävs" }, { status: 422 });
  }
  const merchant =
    typeof body.merchant === "string" ? body.merchant.trim() || null : expense.merchant;
  const purchaseDate =
    body.purchaseDate === "" || body.purchaseDate === null
      ? null
      : body.purchaseDate
        ? new Date(body.purchaseDate)
        : expense.purchaseDate;
  const grossAmount = "grossAmount" in body ? toOre(body.grossAmount) : expense.grossAmount;
  const paymentType =
    body.paymentType === "CARD" || body.paymentType === "REIMBURSEMENT"
      ? body.paymentType
      : expense.paymentType;

  if ((grossAmount ?? 0) < 0) {
    return NextResponse.json({ error: "Belopp kan inte vara negativt" }, { status: 422 });
  }

  // Allocations: [{costCenterCode: string, amount: number (SEK), comment?: string}]
  type AllocInput = { costCenterCode: string; amount: number; comment?: string };
  let newAllocs: { costCenterId: string; amount: number; comment: string | null }[] | null = null;
  if (Array.isArray(body.allocations)) {
    const inputs: AllocInput[] = body.allocations;
    if (inputs.some((a) => (a.amount ?? 0) < 0)) {
      return NextResponse.json({ error: "Belopp per kostnadsställe kan inte vara negativt" }, { status: 422 });
    }
    const codes = [...new Set(inputs.map((a) => a.costCenterCode))];
    const centers = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
    const centerMap = new Map(centers.map((c) => [c.code, c.id]));
    for (const a of inputs) {
      if (!centerMap.has(a.costCenterCode)) {
        return NextResponse.json({ error: `Okänt kostnadsställe: ${a.costCenterCode}` }, { status: 422 });
      }
    }
    newAllocs = inputs.map((a) => ({
      costCenterId: centerMap.get(a.costCenterCode)!,
      amount: Math.round(a.amount * 100), // SEK → öre
      comment: a.comment?.trim() || null,
    }));
  }

  // Build diff.
  const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  type JsonScalar = string | number | null;
  const diff: Record<string, { from: JsonScalar; to: JsonScalar }> = {};
  const note = (field: string, from: JsonScalar, to: JsonScalar) => {
    if (from !== to) diff[field] = { from, to };
  };
  note("title", expense.title, title);
  note("merchant", expense.merchant, merchant);
  note("purchaseDate", dateStr(expense.purchaseDate), dateStr(purchaseDate));
  note("grossAmount", expense.grossAmount, grossAmount);
  note("paymentType", expense.paymentType, paymentType);

  const allocsChanged =
    newAllocs !== null &&
    JSON.stringify(
      expense.allocations.map((a) => ({ cc: a.costCenter.code, amt: a.amount })).sort((a, b) => a.cc.localeCompare(b.cc)),
    ) !==
    JSON.stringify(
      newAllocs
        .map((a, i) => ({ cc: (body.allocations as AllocInput[])[i].costCenterCode, amt: a.amount }))
        .sort((a, b) => a.cc.localeCompare(b.cc)),
    );
  if (allocsChanged) diff["allocations"] = { from: null, to: null };

  const changedFields = Object.keys(diff);
  if (changedFields.length === 0 && !newAllocs) {
    return NextResponse.json({ ok: true, reference, changed: 0 });
  }

  const actorId = await resolveUserId();
  if (!actorId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expense.id },
        data: { title, merchant, purchaseDate, grossAmount, paymentType },
      });

      if (newAllocs) {
        await tx.expenseCostAllocation.deleteMany({ where: { expenseId: expense.id } });
        if (newAllocs.length > 0) {
          await tx.expenseCostAllocation.createMany({
            data: newAllocs.map((a) => ({
              expenseId: expense.id,
              costCenterId: a.costCenterId,
              amount: a.amount,
              comment: a.comment,
            })),
          });
        }
      }

      if (changedFields.length > 0) {
        const summary = "Ändrade: " + changedFields.map((f) => FIELD_LABELS[f] ?? f).join(", ");
        await tx.expenseEvent.create({
          data: { expenseId: expense.id, type: "EDITED", actorId, comment: summary, diff },
        });
      }
    });
  } catch (err) {
    console.error("[PATCH /api/expenses] transaction failed:", err);
    const msg = err instanceof Error ? err.message : "Databasfel";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reference, changed: changedFields.length }, { status: 200 });
}

// DELETE — admin deletes any; owner deletes own while not yet attested.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: reference } = await ctx.params;

  const expense = await prisma.expense.findUnique({
    where: { reference },
    include: { receipts: { select: { objectKey: true, thumbnailKey: true } } },
  });
  if (!expense) {
    return NextResponse.json({ error: "Utlägget hittades inte" }, { status: 404 });
  }

  const actorId = await resolveUserId();
  if (!actorId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  const isAdmin = actor?.role === "ADMIN";
  const isOwner = actor?.id === expense.submitterId;
  const allowed = isAdmin || (isOwner && !isSigned(expense.status));
  if (!allowed) {
    return NextResponse.json(
      {
        error: isOwner
          ? "Attesterade utlägg kan bara tas bort av en administratör"
          : "Du har inte behörighet att ta bort det här utlägget",
      },
      { status: 403 },
    );
  }

  await Promise.all(
    expense.receipts.flatMap((r) =>
      [r.objectKey, r.thumbnailKey].filter(Boolean).map((k) => deleteObject(k!).catch(() => {})),
    ),
  );
  await prisma.expense.delete({ where: { id: expense.id } });

  return new Response(null, { status: 204 });
}
