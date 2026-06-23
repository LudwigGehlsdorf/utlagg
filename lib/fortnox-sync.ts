// Pull the Fortnox ledger into the local mirror via SIE. Sync is done a whole
// financial year at a time: fetch the year's SIE, parse it, and replace that
// year's vouchers+rows in one transaction. That makes every sync idempotent —
// closed years stay identical, the current year just gets re-pulled — and
// sidesteps per-voucher fetching (and the API rate limit) entirely.
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import {
  fetchSie,
  getValidAccessToken,
  listCostCenters,
  listFinancialYears,
  type FortnoxFinancialYear,
} from "@/lib/fortnox";
import { parseSie } from "@/lib/sie";
import type { Prisma } from "@/lib/generated/prisma/client";

const toOre = (sek: number) => Math.round(sek * 100);

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Refresh the list of financial years (so the report's year picker and the
// sync know what exists). Returns them newest-first.
export async function syncFinancialYears(token: string): Promise<FortnoxFinancialYear[]> {
  const years = await listFinancialYears(token);
  for (const y of years) {
    await prisma.fortnoxFinancialYear.upsert({
      where: { id: y.id },
      create: { id: y.id, fromDate: new Date(y.fromDate), toDate: new Date(y.toDate) },
      update: { fromDate: new Date(y.fromDate), toDate: new Date(y.toDate) },
    });
  }
  return years.sort((a, b) => b.id - a.id);
}

export interface CostCenterSyncResult {
  upserted: number;
  deactivated: number;
}

// Sync the app's CostCenter list from Fortnox: the cost centres that are active
// in Fortnox become the selectable ones. Matching is by code — existing rows
// keep their committee + attestant; cost centres not active in Fortnox are
// deactivated (never deleted, to preserve budget/ledger/expense references).
export async function syncCostCenters(token: string): Promise<CostCenterSyncResult> {
  const fortnoxCcs = await listCostCenters(token);
  const activeCodes = new Set(fortnoxCcs.filter((c) => c.active).map((c) => c.code));

  let upserted = 0;
  for (const c of fortnoxCcs) {
    await prisma.costCenter.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.description, active: c.active },
      update: { name: c.description, active: c.active },
    });
    upserted++;
  }

  // Deactivate any app cost centre that isn't an active Fortnox cost centre.
  const { count: deactivated } = await prisma.costCenter.updateMany({
    where: { code: { notIn: [...activeCodes] }, active: true },
    data: { active: false },
  });

  return { upserted, deactivated };
}

export interface YearSyncResult {
  financialYear: number;
  vouchers: number;
  rows: number;
}

// Replace one financial year's ledger from its SIE export. Assumes the
// FortnoxFinancialYear row already exists (syncLedger upserts it first).
export async function syncYear(token: string, fyId: number): Promise<YearSyncResult> {
  const parsed = parseSie(await fetchSie(token, fyId));

  const voucherRecords: Prisma.LedgerVoucherCreateManyInput[] = [];
  const rowRecords: Prisma.LedgerRowCreateManyInput[] = [];

  for (const v of parsed.vouchers) {
    const voucherId = randomUUID();
    voucherRecords.push({
      id: voucherId,
      financialYear: fyId,
      series: v.series,
      number: v.number,
      date: new Date(`${v.date}T00:00:00Z`),
      description: v.description,
    });
    for (const tr of v.transactions) {
      rowRecords.push({
        id: randomUUID(),
        voucherId,
        account: tr.account,
        accountName: parsed.accounts.get(tr.account) ?? "",
        costCenterCode: tr.costCenterCode ?? null,
        costCenterName: tr.costCenterCode
          ? parsed.costCenters.get(tr.costCenterCode) ?? null
          : null,
        text: tr.text ?? null,
        debit: tr.amount > 0 ? toOre(tr.amount) : 0,
        credit: tr.amount < 0 ? toOre(-tr.amount) : 0,
      });
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.ledgerVoucher.deleteMany({ where: { financialYear: fyId } });
      for (const chunk of chunks(voucherRecords, 1000)) {
        await tx.ledgerVoucher.createMany({ data: chunk });
      }
      for (const chunk of chunks(rowRecords, 2000)) {
        await tx.ledgerRow.createMany({ data: chunk });
      }
      await tx.fortnoxFinancialYear.update({
        where: { id: fyId },
        data: { lastSyncAt: new Date() },
      });
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return { financialYear: fyId, vouchers: voucherRecords.length, rows: rowRecords.length };
}

export interface LedgerSyncResult {
  years: YearSyncResult[];
  costCenters?: CostCenterSyncResult;
}

// Entry point. scope "current" syncs only the year containing today (fast,
// one SIE call); "all" syncs every financial year (the full backfill); pass a
// specific `year` (Fortnox FY id) to sync just that one.
export async function syncLedger(opts: {
  scope: "current" | "all";
  year?: number;
}): Promise<LedgerSyncResult> {
  const token = await getValidAccessToken();
  const years = await syncFinancialYears(token);

  // Refresh the cost-centre list too — best effort, since it needs the
  // `costcenter` scope which an older connection may not have granted.
  let costCenters: CostCenterSyncResult | undefined;
  try {
    costCenters = await syncCostCenters(token);
  } catch {
    costCenters = undefined;
  }

  let targets: FortnoxFinancialYear[];
  if (opts.year != null) {
    targets = years.filter((y) => y.id === opts.year);
  } else if (opts.scope === "current") {
    const today = new Date().toISOString().slice(0, 10);
    const containing = years.find((y) => y.fromDate <= today && today <= y.toDate);
    targets = containing ? [containing] : years.slice(0, 1); // newest as fallback
  } else {
    targets = years;
  }

  const results: YearSyncResult[] = [];
  for (const y of targets) results.push(await syncYear(token, y.id));
  return { years: results, costCenters };
}
