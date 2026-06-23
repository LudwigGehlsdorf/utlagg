// Queries over the local Fortnox ledger mirror (see lib/fortnox-sync.ts).
// Amounts are returned in SEK (the rest of the UI works in SEK), except the
// budget-vs-actual helper which stays in öre for exact matching.
import { prisma } from "@/lib/db";

const ore = (v: number | null | undefined) => (v ?? 0) / 100;

export interface LedgerYear {
  id: number; // Fortnox financial-year id
  year: number; // calendar year (from FromDate)
  lastSyncAt: string | null; // ISO
}

export async function getLedgerYears(): Promise<LedgerYear[]> {
  const years = await prisma.fortnoxFinancialYear.findMany({ orderBy: { fromDate: "desc" } });
  return years.map((y) => ({
    id: y.id,
    year: y.fromDate.getUTCFullYear(),
    lastSyncAt: y.lastSyncAt?.toISOString() ?? null,
  }));
}

// Resolve a Fortnox financial-year id from a calendar year (the budget works in
// calendar years). Returns null if that year hasn't been synced.
export async function financialYearIdForCalendarYear(year: number): Promise<number | null> {
  const fy = await prisma.fortnoxFinancialYear.findFirst({
    where: {
      fromDate: { gte: new Date(Date.UTC(year, 0, 1)) },
      toDate: { lte: new Date(Date.UTC(year, 11, 31)) },
    },
  });
  return fy?.id ?? null;
}

export interface SpendAccount {
  account: string;
  accountName: string;
  debit: number; // SEK
  credit: number; // SEK
  net: number; // SEK (debit − credit)
}

export interface SpendGroup {
  costCenterCode: string | null;
  costCenterName: string | null;
  accounts: SpendAccount[];
  debit: number;
  credit: number;
  net: number;
}

// Spend grouped by cost centre → account for one financial year, optionally
// scoped to a single cost-centre code.
export async function getSpendByYear(
  financialYear: number,
  opts: { costCenterCode?: string } = {},
): Promise<SpendGroup[]> {
  const grouped = await prisma.ledgerRow.groupBy({
    by: ["costCenterCode", "costCenterName", "account", "accountName"],
    where: {
      voucher: { financialYear },
      ...(opts.costCenterCode ? { costCenterCode: opts.costCenterCode } : {}),
    },
    _sum: { debit: true, credit: true },
  });

  const byCc = new Map<string, SpendGroup>();
  for (const g of grouped) {
    const key = g.costCenterCode ?? "";
    let group = byCc.get(key);
    if (!group) {
      group = {
        costCenterCode: g.costCenterCode,
        costCenterName: g.costCenterName,
        accounts: [],
        debit: 0,
        credit: 0,
        net: 0,
      };
      byCc.set(key, group);
    }
    const debit = ore(g._sum.debit);
    const credit = ore(g._sum.credit);
    group.accounts.push({
      account: g.account,
      accountName: g.accountName,
      debit,
      credit,
      net: debit - credit,
    });
    group.debit += debit;
    group.credit += credit;
    group.net += debit - credit;
  }

  const groups = [...byCc.values()];
  for (const grp of groups) grp.accounts.sort((a, b) => a.account.localeCompare(b.account));
  // Named cost centres first (alpha), the "no cost centre" bucket last.
  groups.sort((a, b) => {
    if (!a.costCenterCode) return 1;
    if (!b.costCenterCode) return -1;
    return a.costCenterCode.localeCompare(b.costCenterCode);
  });
  return groups;
}

export interface LedgerRowView {
  id: string;
  date: string; // ISO
  voucher: string; // e.g. "A-42"
  description: string; // voucher text
  text: string | null; // transaction text
  debit: number; // SEK
  credit: number; // SEK
}

// Individual voucher rows behind a (year, cost centre, account) cell — the
// drill-down for the report.
export async function getLedgerRows(
  financialYear: number,
  account: string,
  costCenterCode: string | null,
): Promise<LedgerRowView[]> {
  const rows = await prisma.ledgerRow.findMany({
    where: {
      account,
      costCenterCode: costCenterCode ?? null,
      voucher: { financialYear },
    },
    include: { voucher: true },
    orderBy: [{ voucher: { date: "asc" } }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.voucher.date.toISOString().slice(0, 10),
    voucher: `${r.voucher.series}-${r.voucher.number}`,
    description: r.voucher.description,
    text: r.text,
    debit: ore(r.debit),
    credit: ore(r.credit),
  }));
}

// Actuals for budget-vs-actual, keyed `${costCenterCode}|${account}` → öre net.
// net is signed so the caller can apply income/cost orientation. Returns an
// empty map (not an error) when the year hasn't been synced.
export async function getActualsByAccountCostCenter(
  calendarYear: number,
): Promise<Map<string, { debit: number; credit: number }>> {
  const fyId = await financialYearIdForCalendarYear(calendarYear);
  const out = new Map<string, { debit: number; credit: number }>();
  if (fyId == null) return out;

  const grouped = await prisma.ledgerRow.groupBy({
    by: ["costCenterCode", "account"],
    where: { voucher: { financialYear: fyId } },
    _sum: { debit: true, credit: true },
  });
  for (const g of grouped) {
    const key = `${g.costCenterCode ?? ""}|${g.account}`;
    out.set(key, { debit: g._sum.debit ?? 0, credit: g._sum.credit ?? 0 });
  }
  return out;
}
