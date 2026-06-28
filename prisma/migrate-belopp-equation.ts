// One-off data migration: fold the old "antal × á-pris" form into the Belopp
// cell now that quantity/unitPrice are gone. A line whose amount came from
// `quantity * unitPrice` (both set) is rewritten so its `expression` is the
// equivalent formula "=(<antal>)*(<á-pris>)", preserving both the value and an
// editable equation. quantity/unitPrice are then cleared on every line.
//
//   pnpm tsx prisma/migrate-belopp-equation.ts
//
// Idempotent: once quantity/unitPrice are null there is nothing left to rewrite.
// Only rewrites rows where BOTH sides were set (those are the ones whose value
// lived in the product); rows with a single stray side keep their expression.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

process.loadEnvFile?.(".env");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Strip a leading "=" so a cell value can be embedded inside a larger formula.
function inner(cell: string): string {
  const s = cell.trim();
  return s.startsWith("=") ? s.slice(1).trim() : s;
}

async function main() {
  const rows = await prisma.budgetLineItem.findMany({
    where: { OR: [{ quantity: { not: null } }, { unitPrice: { not: null } }] },
    select: { id: true, quantity: true, unitPrice: true, expression: true },
  });

  let rewritten = 0;
  let cleared = 0;
  for (const r of rows) {
    const q = r.quantity?.trim();
    const u = r.unitPrice?.trim();
    const data: { quantity: null; unitPrice: null; expression?: string } = { quantity: null, unitPrice: null };
    if (q && u) {
      data.expression = `=(${inner(q)})*(${inner(u)})`;
      rewritten++;
    } else {
      cleared++;
    }
    await prisma.budgetLineItem.update({ where: { id: r.id }, data });
  }

  console.log(`Rewrote ${rewritten} antal×á-pris line(s) into Belopp formulas; cleared ${cleared} stray side(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
