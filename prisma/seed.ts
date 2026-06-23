// Seeds the database from the mockup's static data (lib/mock-data.ts) so the
// real app starts with the same scenarios the design was validated against.
// Idempotent: wipes the domain tables and re-inserts on every run.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ExpenseEventType, type Role } from "../lib/generated/prisma/client";

// Standalone run (pnpm db:seed) — load .env ourselves.
process.loadEnvFile?.(".env");
import {
  BANK_TRANSACTIONS,
  CARDS,
  COST_CENTERS,
  CURRENT_USERS,
  EXPENSES,
  type SeedExpense,
} from "./seed-data";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// öre — store money as integer minor units.
const ore = (sek: number) => Math.round(sek * 100);

// "Elsa Lindqvist" → "elsa.lindqvist@dsek.se"
const emailFor = (name: string) =>
  name
    .toLowerCase()
    .replace(/å|ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/\s+/g, ".") + "@dsek.se";

// Map the mockup's free-text revision actions to typed audit events.
const EVENT_TYPE: Record<string, ExpenseEventType> = {
  "Skapade utlägget": "CREATED",
  "Fyllde i kvittouppgifter": "EDITED",
  "Matchade mot banktransaktion": "MATCHED",
  "Skickade in för attest": "SUBMITTED",
  "Begärde ändring": "CHANGES_REQUESTED",
  "Attesterade utlägget": "APPROVED",
  "Bokförde utlägget": "BOOKED",
  "Exporterade till Fortnox": "EXPORTED",
};

async function main() {
  // Clear in FK-safe order (allocations cascade from expenses).
  await prisma.expenseEvent.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.bankTransaction.deleteMany();
  await prisma.card.deleteMany();
  await prisma.costCenter.deleteMany();
  await prisma.user.deleteMany();

  // ── Users ───────────────────────────────────────────────────────
  // Every distinct person referenced anywhere in the mock data.
  const roleByName = new Map<string, Role>();
  for (const u of Object.values(CURRENT_USERS)) roleByName.set(u.name, u.role);
  for (const c of COST_CENTERS)
    if (!roleByName.has(c.approverName)) roleByName.set(c.approverName, "APPROVER");
  for (const e of EXPENSES) {
    if (!roleByName.has(e.submitterName)) roleByName.set(e.submitterName, "MEMBER");
    for (const r of e.revisions)
      if (!roleByName.has(r.actor)) roleByName.set(r.actor, "MEMBER");
  }

  const usersByName = new Map<string, string>(); // name → user id
  for (const [name, role] of roleByName) {
    const user = await prisma.user.create({
      data: { name, email: emailFor(name), role },
    });
    usersByName.set(name, user.id);
  }
  const userId = (name: string) => {
    const id = usersByName.get(name);
    if (!id) throw new Error(`No user seeded for "${name}"`);
    return id;
  };

  // ── Cost centers ────────────────────────────────────────────────
  const costCenterByCode = new Map<string, string>();
  for (const c of COST_CENTERS) {
    const cc = await prisma.costCenter.create({
      data: { code: c.code, name: c.name, approverId: userId(c.approverName) },
    });
    costCenterByCode.set(c.code, cc.id);
  }

  // ── Bank transactions ───────────────────────────────────────────
  const txByMockId = new Map<string, string>(); // mock "t3" → real id
  for (const t of BANK_TRANSACTIONS) {
    const tx = await prisma.bankTransaction.create({
      data: {
        bookedDate: new Date(t.bookedDate),
        description: t.description,
        amount: ore(t.amount),
      },
    });
    txByMockId.set(t.id, tx.id);
  }

  // ── Section cards ───────────────────────────────────────────────
  for (const card of CARDS) {
    const created = await prisma.card.create({
      data: {
        last4: card.last4,
        holderId: card.holderName ? userId(card.holderName) : null,
      },
    });
    for (const tid of card.transactionIds) {
      const txId = txByMockId.get(tid);
      if (txId) {
        await prisma.bankTransaction.update({
          where: { id: txId },
          data: { cardId: created.id, cardLast4: card.last4 },
        });
      }
    }
  }

  // ── Expenses (+ allocations + events) ──────────────────────────
  for (const e of EXPENSES) {
    const created = await prisma.expense.create({
      data: {
        reference: e.id,
        title: e.title,
        submitterId: userId(e.submitterName),
        paymentType: e.paymentType,
        status: e.status,
        merchant: e.merchant,
        purchaseDate: new Date(e.purchaseDate),
        grossAmount: ore(e.grossAmount),
        currency: e.currency,
        matchedTransactionId: e.matchedTransactionId
          ? txByMockId.get(e.matchedTransactionId)
          : null,
        events: {
          create: e.revisions.map((r) => ({
            type: EVENT_TYPE[r.action] ?? "EDITED",
            actorId: userId(r.actor),
            comment: r.comment ?? null,
            createdAt: new Date(r.date),
          })),
        },
      },
    });
    for (const a of e.allocations) {
      const ccId = costCenterByCode.get(a.costCenterCode);
      if (!ccId) throw new Error(`Unknown cost center code "${a.costCenterCode}" in expense ${e.id}`);
      await prisma.expenseCostAllocation.create({
        data: {
          expenseId: created.id,
          costCenterId: ccId,
          amount: ore(a.amount),
        },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    costCenters: await prisma.costCenter.count(),
    bankTransactions: await prisma.bankTransaction.count(),
    cards: await prisma.card.count(),
    expenses: await prisma.expense.count(),
    allocations: await prisma.expenseCostAllocation.count(),
    events: await prisma.expenseEvent.count(),
  };
  console.log("Seeded:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
