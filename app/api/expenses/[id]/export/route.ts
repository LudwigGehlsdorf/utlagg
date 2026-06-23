// Export a BOOKED expense's verifikation to Fortnox: create the voucher, attach
// the receipt, store the returned voucher number, and only then flip the expense
// to EXPORTED. If the Fortnox call fails, nothing is mutated locally — the
// bookkeeper can retry. The [id] param is the human reference (e.g. U-2026-0043).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveUser } from "@/lib/current-user";
import { getObjectBuffer } from "@/lib/storage";
import {
  connectFileToVoucher,
  createVoucher,
  getConnection,
  getValidAccessToken,
  uploadInboxFile,
  FortnoxError,
  type VoucherRowInput,
} from "@/lib/fortnox";

export const runtime = "nodejs";

const ore = (n: number) => Math.round(n) / 100; // öre int → SEK decimal

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: reference } = await ctx.params;

  const user = await resolveUser();
  if (!user) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  if (user.role !== "BOOKKEEPER" && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Endast bokförare kan exportera till Fortnox" },
      { status: 403 },
    );
  }

  const expense = await prisma.expense.findUnique({
    where: { reference },
    include: {
      verification: { include: { lines: { include: { costCenter: true } } } },
      receipts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!expense) {
    return NextResponse.json({ error: "Utlägget hittades inte" }, { status: 404 });
  }
  if (expense.status !== "BOOKED") {
    return NextResponse.json(
      { error: `Bara bokförda utlägg kan exporteras (status: ${expense.status})` },
      { status: 409 },
    );
  }
  const verification = expense.verification;
  if (!verification) {
    return NextResponse.json({ error: "Ingen verifikation att exportera" }, { status: 409 });
  }

  const conn = await getConnection();
  if (!conn) {
    return NextResponse.json(
      { error: "Fortnox är inte anslutet. Anslut under Bokföring." },
      { status: 409 },
    );
  }

  const rows: VoucherRowInput[] = verification.lines.map((l) => ({
    account: Number(l.account),
    debit: ore(l.debit),
    credit: ore(l.credit),
    costCenter: l.costCenter?.code,
    description: l.description ?? undefined,
  }));

  let created;
  let attachWarning: string | null = null;
  try {
    const token = await getValidAccessToken();
    created = await createVoucher(token, {
      series: conn.voucherSeries,
      date: verification.date.toISOString().slice(0, 10),
      description: `${expense.reference} – ${verification.description}`,
      rows,
    });

    // Attach the receipt — best effort: a successful voucher should not be
    // rolled back just because the file upload failed.
    const receipt = expense.receipts[0];
    if (receipt) {
      try {
        const { bytes } = await getObjectBuffer(receipt.objectKey);
        const fileId = await uploadInboxFile(
          token,
          bytes,
          receipt.filename,
          receipt.mimeType,
        );
        await connectFileToVoucher(token, fileId, created.series, created.number);
      } catch (e) {
        attachWarning =
          e instanceof FortnoxError ? e.message : "Kvittot kunde inte bifogas i Fortnox.";
      }
    }
  } catch (e) {
    if (e instanceof FortnoxError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 502 });
    }
    return NextResponse.json(
      { error: "Kunde inte exportera till Fortnox." },
      { status: 502 },
    );
  }

  const label = `${created.series}-${created.number}`;
  await prisma.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verification.id },
      data: {
        fortnoxSeries: created.series,
        fortnoxNumber: created.number,
        fortnoxYear: created.year,
        exportedAt: new Date(),
      },
    });
    await tx.expense.update({ where: { id: expense.id }, data: { status: "EXPORTED" } });
    await tx.expenseEvent.create({
      data: {
        expenseId: expense.id,
        type: "EXPORTED",
        actorId: user.id,
        comment: `Exporterad till Fortnox (verifikat ${label})`,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    reference,
    voucher: created,
    label,
    attachWarning,
  });
}
