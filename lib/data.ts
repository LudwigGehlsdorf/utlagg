// Server-side data layer. Reads from Postgres (Prisma) and maps rows into the
// exact UI shapes the screens already use (lib/types.ts) — öre → SEK numbers,
// typed events → Swedish revision labels, relations → names. This is the single
// place the DB schema meets the frontend, so the pages stay unchanged.
import { prisma } from "./db";
import type { ExpenseEventType } from "./generated/prisma/client";
import type {
  BankTransaction,
  Card,
  Committee,
  CostAllocation,
  CostCenter,
  Expense,
  FortnoxStatus,
  User,
} from "./types";
import { fortnoxConfigured } from "./fortnox";

const ore = (v: number | null | undefined) => (v ?? 0) / 100;
const isoDate = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Typed audit events → human-readable Swedish labels (rendered in the timeline).
const EVENT_LABEL: Record<ExpenseEventType, string> = {
  CREATED: "Skapade utlägget",
  EDITED: "Uppdaterade uppgifter",
  RECEIPT_UPLOADED: "Laddade upp kvitto",
  MATCHED: "Matchade mot banktransaktion",
  UNMATCHED: "Tog bort matchningen",
  SUBMITTED: "Skickade in för attest",
  CHANGES_REQUESTED: "Begärde ändring",
  COST_CENTER_APPROVED: "Attesterade kostnadsställe",
  APPROVED: "Attesterade utlägget",
  REJECTED: "Avslog utlägget",
  BOOKED: "Bokförde utlägget",
  EXPORTED: "Exporterade till Fortnox",
};

export async function getUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    position: u.position ?? undefined,
    initials: initials(u.name),
  }));
}

export async function getCostCenters(): Promise<CostCenter[]> {
  const ccs = await prisma.costCenter.findMany({
    orderBy: { code: "asc" },
    include: { approver: true },
  });
  return ccs.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    committee: c.committee ?? undefined,
    approverId: c.approverId ?? undefined,
    approverName: c.approver?.name ?? "—",
    active: c.active,
  }));
}

// Committees (the grouping label on cost centres) with their responsible owner.
// Combines the distinct committee labels in use with the CommitteeOwner mapping.
export async function getCommittees(): Promise<Committee[]> {
  const [ccs, owners] = await Promise.all([
    prisma.costCenter.findMany({ select: { committee: true } }),
    prisma.committeeOwner.findMany({ include: { owner: true } }),
  ]);
  const counts = new Map<string, number>();
  for (const c of ccs) {
    if (!c.committee) continue;
    counts.set(c.committee, (counts.get(c.committee) ?? 0) + 1);
  }
  const ownerByName = new Map(owners.map((o) => [o.committee, o]));
  // Include any committee that has an owner row even if no cost centre uses it.
  for (const o of owners) if (!counts.has(o.committee)) counts.set(o.committee, 0);

  return [...counts.entries()]
    .map(([committee, costCenterCount]) => {
      const o = ownerByName.get(committee);
      return {
        committee,
        ownerId: o?.ownerId ?? undefined,
        ownerName: o?.owner?.name ?? undefined,
        costCenterCount,
      };
    })
    .sort((a, b) => a.committee.localeCompare(b.committee));
}

export async function getBankTransactions(): Promise<BankTransaction[]> {
  const txns = await prisma.bankTransaction.findMany({
    orderBy: { bookedDate: "desc" },
    include: { matchedExpense: true, card: { include: { holder: true } } },
  });
  return txns.map((t) => ({
    id: t.id,
    bookedDate: isoDate(t.bookedDate),
    description: t.description,
    amount: ore(t.amount),
    matchedExpenseId: t.matchedExpense?.reference ?? undefined,
    cardLast4: t.cardLast4 ?? t.card?.last4 ?? undefined,
    cardHolderId: t.card?.holderId ?? undefined,
    cardHolderName: t.card?.holder?.name ?? undefined,
  }));
}

export async function getCards(): Promise<Card[]> {
  const cards = await prisma.card.findMany({
    orderBy: { last4: "asc" },
    include: { holder: true },
  });
  return cards.map((c) => ({
    id: c.id,
    last4: c.last4,
    holderId: c.holderId ?? undefined,
    holderName: c.holder?.name,
    active: c.active,
  }));
}

export async function getExpenses(): Promise<Expense[]> {
  const expenses = await prisma.expense.findMany({
    orderBy: { reference: "desc" },
    include: {
      submitter: true,
      allocations: {
        include: {
          costCenter: { include: { approver: true } },
          approvedBy: true,
        },
      },
      matchedTransaction: true,
      events: { orderBy: { createdAt: "asc" }, include: { actor: true } },
      receipts: { orderBy: { createdAt: "desc" }, take: 1 },
      verification: {
        include: {
          createdBy: true,
          lines: { orderBy: { sortOrder: "asc" }, include: { costCenter: true } },
        },
      },
    },
  });
  return expenses.map((e) => ({
    id: e.reference,
    title: e.title,
    submitterName: e.submitter.name,
    allocations: e.allocations.map((a): CostAllocation => ({
      id: a.id,
      costCenterId: a.costCenterId,
      costCenterCode: a.costCenter.code,
      costCenterName: a.costCenter.name,
      approverId: a.costCenter.approverId ?? undefined,
      approverName: a.costCenter.approver?.name ?? "—",
      amount: ore(a.amount),
      comment: a.comment ?? undefined,
      approvedById: a.approvedById ?? undefined,
      approvedByName: a.approvedBy?.name ?? undefined,
      approvedAt: a.approvedAt?.toISOString() ?? undefined,
    })),
    paymentType: e.paymentType,
    status: (e.status === "REJECTED" ? "CHANGES_REQUESTED" : e.status) as Expense["status"],
    merchant: e.merchant ?? "",
    purchaseDate: isoDate(e.purchaseDate),
    grossAmount: ore(e.grossAmount),
    currency: e.currency,
    matchedTransactionId: e.matchedTransactionId ?? undefined,
    receiptId: e.receipts[0]?.id,
    receiptMimeType: e.receipts[0]?.mimeType,
    verification: e.verification
      ? {
          date: isoDate(e.verification.date),
          description: e.verification.description,
          createdBy: e.verification.createdBy?.name,
          fortnoxLabel:
            e.verification.fortnoxSeries && e.verification.fortnoxNumber != null
              ? `${e.verification.fortnoxSeries}-${e.verification.fortnoxNumber}`
              : undefined,
          exportedAt: e.verification.exportedAt?.toISOString() ?? undefined,
          lines: e.verification.lines.map((l) => ({
            id: l.id,
            account: l.account,
            accountName: l.accountName,
            description: l.description ?? undefined,
            costCenterCode: l.costCenter?.code,
            debit: ore(l.debit),
            credit: ore(l.credit),
          })),
        }
      : undefined,
    revisions: e.events.map((ev) => ({
      id: ev.id,
      actor: ev.actor?.name ?? "System",
      action: EVENT_LABEL[ev.type],
      comment: ev.comment ?? undefined,
      date: ev.createdAt.toISOString(),
    })),
  }));
}

// The org's single Fortnox connection status (no secrets — safe for the client).
export async function getFortnoxStatus(): Promise<FortnoxStatus> {
  const conn = await prisma.fortnoxConnection.findFirst({ orderBy: { createdAt: "desc" } });
  return {
    configured: fortnoxConfigured(),
    connected: Boolean(conn),
    companyName: conn?.companyName ?? undefined,
    voucherSeries: conn?.voucherSeries ?? undefined,
    expiresAt: conn?.expiresAt?.toISOString() ?? undefined,
  };
}

export async function getAllData() {
  const [users, costCenters, committees, bankTransactions, expenses, cards, fortnox] =
    await Promise.all([
      getUsers(),
      getCostCenters(),
      getCommittees(),
      getBankTransactions(),
      getExpenses(),
      getCards(),
      getFortnoxStatus(),
    ]);
  return { users, costCenters, committees, bankTransactions, expenses, cards, fortnox };
}

export type AppData = Awaited<ReturnType<typeof getAllData>>;
