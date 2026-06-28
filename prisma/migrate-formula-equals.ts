// One-off data migration: adopt the strict spreadsheet convention where a cell
// is a literal number unless it starts with "=". Existing budgets stored
// formulas without any "=" (e.g. "350*2", "MEDLEMMAR*150", "account(SEX02,3015)"),
// so we prefix "=" to anything that isn't a plain number. Pure numbers ("350",
// "1500.5") are left as literals. Idempotent: a value already starting with "="
// (or null/empty) is untouched.
//
//   pnpm tsx prisma/migrate-formula-equals.ts
//
// This only rewrites row values (no schema change), so it is safe despite the
// migration drift noted in the budget-tool memory.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

process.loadEnvFile?.(".env");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PURE_NUMBER = /^-?\d+(\.\d+)?$/;

// null/empty → unchanged; pure number → literal; already "=" → unchanged;
// otherwise it's a formula → prefix "=".
function toStrict(v: string | null): { next: string | null; changed: boolean } {
  if (v === null) return { next: null, changed: false };
  const s = v.trim();
  if (!s) return { next: v, changed: false };
  if (s.startsWith("=")) return { next: v, changed: false };
  if (PURE_NUMBER.test(s.replace(/[\s_]/g, ""))) return { next: v, changed: false };
  return { next: "=" + s, changed: true };
}

async function main() {
  let liChanged = 0;
  const lineItems = await prisma.budgetLineItem.findMany({
    select: { id: true, expression: true, quantity: true, unitPrice: true },
  });
  for (const li of lineItems) {
    const e = toStrict(li.expression);
    const q = toStrict(li.quantity);
    const u = toStrict(li.unitPrice);
    if (!e.changed && !q.changed && !u.changed) continue;
    await prisma.budgetLineItem.update({
      where: { id: li.id },
      data: { expression: e.next ?? "", quantity: q.next, unitPrice: u.next },
    });
    liChanged++;
  }

  let varChanged = 0;
  const variables = await prisma.budgetVariable.findMany({
    select: { id: true, expression: true },
  });
  for (const v of variables) {
    const e = toStrict(v.expression);
    if (!e.changed) continue;
    await prisma.budgetVariable.update({
      where: { id: v.id },
      data: { expression: e.next ?? "" },
    });
    varChanged++;
  }

  console.log(`Updated ${liChanged}/${lineItems.length} line items, ${varChanged}/${variables.length} variables.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
