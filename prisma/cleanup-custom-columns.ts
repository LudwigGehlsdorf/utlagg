// One-off cleanup for the move to the fixed 9-column layout: the dynamic custom
// columns are gone, so delete every BudgetColumn row and strip any per-line
// `values` keys that aren't one of the six fixed general columns (x1…x6).
//
//   pnpm tsx prisma/cleanup-custom-columns.ts
//
// Idempotent: re-running finds no columns and leaves already-clean values alone.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { EXTRA_COLUMN_KEYS } from "../lib/budget-grid";

process.loadEnvFile?.(".env");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const keep = new Set<string>(EXTRA_COLUMN_KEYS);

  const cols = await prisma.budgetColumn.deleteMany({});

  const lines = await prisma.budgetLineItem.findMany({ select: { id: true, values: true } });
  let stripped = 0;
  for (const li of lines) {
    const v = (li.values ?? {}) as Record<string, string>;
    const cleaned = Object.fromEntries(Object.entries(v).filter(([k]) => keep.has(k)));
    if (Object.keys(cleaned).length !== Object.keys(v).length) {
      await prisma.budgetLineItem.update({ where: { id: li.id }, data: { values: cleaned } });
      stripped++;
    }
  }

  console.log(`Deleted ${cols.count} custom column(s); stripped orphaned values on ${stripped} line(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
