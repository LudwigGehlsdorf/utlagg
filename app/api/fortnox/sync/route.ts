// Trigger a Fortnox ledger sync. Body: { scope?: "current" | "all", year?: number }.
// Default is "current" (one SIE call — fast, safe for an interactive button).
// "all" backfills every financial year and can take a while; prefer the CLI
// (pnpm fortnox:sync) or the scheduled job for that.
import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/current-user";
import { getConnection } from "@/lib/fortnox";
import { syncLedger } from "@/lib/fortnox-sync";

export const runtime = "nodejs";
export const maxDuration = 300; // allow long backfills on platforms that honour it

export async function POST(req: Request) {
  const user = await resolveUser();
  if (!user) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  if (user.role !== "BOOKKEEPER" && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Endast bokförare kan synka från Fortnox" },
      { status: 403 },
    );
  }
  if (!(await getConnection())) {
    return NextResponse.json({ error: "Fortnox är inte anslutet." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const scope = body.scope === "all" ? "all" : "current";
  const year = typeof body.year === "number" ? body.year : undefined;

  try {
    const result = await syncLedger({ scope, year });
    const vouchers = result.years.reduce((s, y) => s + y.vouchers, 0);
    return NextResponse.json({ ok: true, ...result, totalVouchers: vouchers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Synkningen misslyckades";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
