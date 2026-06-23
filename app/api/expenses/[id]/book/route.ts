// Book an approved expense (POST) or amend a booked voucher before export
// (PATCH). The [id] param is the human reference (e.g. U-2026-0043).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";

export const runtime = "nodejs";

interface LineInput {
  account?: string;
  accountName?: string;
  description?: string;
  costCenterCode?: string;
  debit?: number; // öre
  credit?: number; // öre
}

interface NormLine {
  account: string;
  accountName: string;
  description: string | null;
  costCenterCode: string | null;
  debit: number; // öre
  credit: number; // öre
}

// Parse + validate the voucher lines: each row needs an account, amounts are
// non-negative, and the verification must balance (debit total == credit total).
function prepareLines(
  body: { lines?: unknown },
): { ok: true; lines: NormLine[] } | { ok: false; error: string; status: number } {
  const rawLines: LineInput[] = Array.isArray(body.lines) ? body.lines : [];
  const lines: NormLine[] = rawLines
    .map((l) => ({
      account: String(l.account ?? "").trim(),
      accountName: String(l.accountName ?? "").trim(),
      description: l.description?.toString().trim() || null,
      costCenterCode: l.costCenterCode?.toString() || null,
      debit: Math.round(Number(l.debit) || 0),
      credit: Math.round(Number(l.credit) || 0),
    }))
    .filter((l) => l.account || l.debit || l.credit);

  if (lines.length < 2) {
    return { ok: false, error: "Minst två rader krävs", status: 422 };
  }
  if (lines.some((l) => !l.account)) {
    return { ok: false, error: "Alla rader måste ha ett konto", status: 422 };
  }
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) {
    return { ok: false, error: "Belopp kan inte vara negativa", status: 422 };
  }
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebit === 0 || totalDebit !== totalCredit) {
    return { ok: false, error: "Verifikationen balanserar inte (debet ≠ kredit)", status: 422 };
  }
  return { ok: true, lines };
}

// Resolve the cost-center codes used by the lines to their ids.
async function costCenterIdByCode(lines: NormLine[]): Promise<Map<string, string>> {
  const codes = [...new Set(lines.map((l) => l.costCenterCode).filter(Boolean))] as string[];
  const ccs = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
  return new Map(ccs.map((c) => [c.code, c.id]));
}

// POST — create the voucher for an APPROVED expense and flip it to BOOKED.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: reference } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const expense = await prisma.expense.findUnique({ where: { reference } });
  if (!expense) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  if (expense.status !== "APPROVED") {
    return NextResponse.json(
      { error: `Kan bara bokföra attesterade utlägg (status: ${expense.status})` },
      { status: 409 },
    );
  }

  const prepared = prepareLines(body);
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.error }, { status: prepared.status });
  }
  const idByCode = await costCenterIdByCode(prepared.lines);

  const actorId = await resolveUserId();
  if (!actorId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }
  const date = body.date ? new Date(body.date) : new Date();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : expense.title;

  await prisma.$transaction(async (tx) => {
    await tx.verification.create({
      data: {
        expenseId: expense.id,
        date,
        description,
        createdById: actorId,
        lines: {
          create: prepared.lines.map((l, i) => ({
            account: l.account,
            accountName: l.accountName,
            description: l.description,
            costCenterId: l.costCenterCode ? idByCode.get(l.costCenterCode) ?? null : null,
            debit: l.debit,
            credit: l.credit,
            sortOrder: i,
          })),
        },
      },
    });
    await tx.expense.update({
      where: { id: expense.id },
      data: { status: "BOOKED" },
    });
    await tx.expenseEvent.create({
      data: { expenseId: expense.id, type: "BOOKED", actorId },
    });
  });

  return NextResponse.json({ ok: true, reference }, { status: 201 });
}

// PATCH — amend the konteringsrader of a BOOKED (not yet EXPORTED) verification.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: reference } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const expense = await prisma.expense.findUnique({
    where: { reference },
    include: { verification: true },
  });
  if (!expense) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  if (expense.status !== "BOOKED") {
    return NextResponse.json(
      {
        error:
          expense.status === "EXPORTED"
            ? "Verifikationen är exporterad och kan inte ändras"
            : `Bara bokförda verifikationer kan ändras (status: ${expense.status})`,
      },
      { status: 409 },
    );
  }
  if (!expense.verification) {
    return NextResponse.json({ error: "Ingen verifikation att ändra" }, { status: 404 });
  }

  const prepared = prepareLines(body);
  if (!prepared.ok) {
    return NextResponse.json({ error: prepared.error }, { status: prepared.status });
  }
  const idByCode = await costCenterIdByCode(prepared.lines);

  const actorId = await resolveUserId();
  if (!actorId) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }
  const date = body.date ? new Date(body.date) : expense.verification.date;
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : expense.verification.description;

  await prisma.$transaction(async (tx) => {
    // Replace all lines in place (verification stays, only its rows change).
    await tx.verification.update({
      where: { expenseId: expense.id },
      data: {
        date,
        description,
        lines: {
          deleteMany: {},
          create: prepared.lines.map((l, i) => ({
            account: l.account,
            accountName: l.accountName,
            description: l.description,
            costCenterId: l.costCenterCode ? idByCode.get(l.costCenterCode) ?? null : null,
            debit: l.debit,
            credit: l.credit,
            sortOrder: i,
          })),
        },
      },
    });
    await tx.expenseEvent.create({
      data: {
        expenseId: expense.id,
        type: "EDITED",
        actorId,
        comment: "Ändrade verifikationen",
      },
    });
  });

  return NextResponse.json({ ok: true, reference }, { status: 200 });
}
