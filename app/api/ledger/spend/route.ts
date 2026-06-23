// Spend per account per cost centre for a financial year (from the Fortnox
// ledger mirror). Returns the available years too, so the report page is
// self-contained. Auth: any signed-in user (it's the org's own accounting).
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/current-user";
import { getLedgerYears, getSpendByYear } from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await resolveUserId())) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const url = new URL(req.url);
  const years = await getLedgerYears();
  const yearParam = Number(url.searchParams.get("year"));
  const selected = years.find((y) => y.id === yearParam) ?? years[0];

  if (!selected) {
    return NextResponse.json({ years: [], year: null, groups: [] });
  }

  const costCenterCode = url.searchParams.get("costCenter") || undefined;
  const groups = await getSpendByYear(selected.id, { costCenterCode });

  return NextResponse.json({ years, year: selected, groups });
}
