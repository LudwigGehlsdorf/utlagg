// Imports the real 2026 budget from prisma/budget-2026.json (produced by
// parse-budget.py) into the database as Budget 2026 with two revisions:
//   "2026 (antagen)" — the originally-adopted baseline column
//   "2026 REV"       — the working revision, with antal × á-pris formulas
// The baseline is wired as Budget.baselineRevisionId so the editor shows the
// two side-by-side. Re-runnable: drops and recreates the 2026 budget.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.loadEnvFile?.(".env");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface ValueRep { quantity: string | null; unitPrice: string | null; expression: string }
interface JsonLineItem { description: string; rev: ValueRep; orig: ValueRep }
interface JsonAccount { code: string; name: string; lineItems: JsonLineItem[] }
interface JsonCostCenter { code: string; name: string; committee: string | null; accounts: JsonAccount[] }
interface JsonVariable { name: string; rev: string; orig: string }
interface BudgetJson { year: number; variables: JsonVariable[]; costCenters: JsonCostCenter[] }

async function main() {
  const data: BudgetJson = JSON.parse(
    readFileSync(join(__dirname, "budget-2026.json"), "utf-8"),
  );

  const admin =
    (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ??
    (await prisma.user.findFirst());
  if (!admin) throw new Error("No user to own the budget — seed the database first.");

  // 1. Upsert a cost center per committee sheet.
  const ccByCode = new Map<string, string>(); // code → CostCenter.id
  for (const cc of data.costCenters) {
    const row = await prisma.costCenter.upsert({
      where: { code: cc.code },
      update: { name: cc.name, committee: cc.committee },
      create: { code: cc.code, name: cc.name, committee: cc.committee },
    });
    ccByCode.set(cc.code, row.id);
  }

  // 2. Fresh Budget 2026.
  await prisma.budget.deleteMany({ where: { year: data.year } });
  const budget = await prisma.budget.create({
    data: { year: data.year, name: `Budget ${data.year}` },
  });

  // 3. Build a revision from one side (rev | orig) of the parsed data.
  async function buildRevision(name: string, side: "rev" | "orig", clonedFromId: string | null) {
    const revision = await prisma.budgetRevision.create({
      data: {
        budgetId: budget.id,
        name,
        createdById: admin!.id,
        clonedFromId,
        variables: {
          create: data.variables.map((v, i) => ({
            name: v.name,
            expression: side === "rev" ? v.rev : v.orig,
            sortOrder: i,
          })),
        },
      },
    });

    for (const [ci, cc] of data.costCenters.entries()) {
      await prisma.budgetCostCenter.create({
        data: {
          revisionId: revision.id,
          costCenterId: ccByCode.get(cc.code)!,
          sortOrder: ci,
          accounts: {
            create: cc.accounts.map((a, ai) => ({
              accountCode: a.code,
              accountName: a.name,
              sortOrder: ai,
              lineItems: {
                create: a.lineItems.map((li, li_i) => {
                  const v = li[side];
                  return {
                    description: li.description,
                    quantity: v.quantity,
                    unitPrice: v.unitPrice,
                    expression: v.expression,
                    sortOrder: li_i,
                  };
                }),
              },
            })),
          },
        },
      });
    }
    return revision;
  }

  const baseline = await buildRevision("2026 (antagen)", "orig", null);
  await buildRevision("2026 REV", "rev", baseline.id);
  await prisma.budget.update({
    where: { id: budget.id },
    data: { baselineRevisionId: baseline.id },
  });

  const accounts = data.costCenters.reduce((s, c) => s + c.accounts.length, 0);
  const lines = data.costCenters.reduce((s, c) => s + c.accounts.reduce((t, a) => t + a.lineItems.length, 0), 0);
  console.log(
    `Imported Budget ${data.year}: 2 revisions, ${data.costCenters.length} cost centers, ` +
    `${accounts} accounts, ${lines} line items each, ${data.variables.length} variables.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
