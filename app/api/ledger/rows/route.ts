// Drill-down: the individual voucher rows behind a (year, account, cost centre)
// cell in the spend report.
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/current-user";
import { getLedgerRows } from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await resolveUserId())) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const account = url.searchParams.get("account");
  // costCenter omitted → the "no cost centre" bucket.
  const costCenter = url.searchParams.get("costCenter");

  if (!year || !account) {
    return NextResponse.json({ error: "year och account krävs" }, { status: 400 });
  }

  const rows = await getLedgerRows(year, account, costCenter || null);
  return NextResponse.json({ rows });
}
