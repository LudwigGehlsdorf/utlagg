// Sync the selectable cost centres from Fortnox (active ones become selectable).
import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/current-user";
import { getConnection, getValidAccessToken, FortnoxError } from "@/lib/fortnox";
import { syncCostCenters } from "@/lib/fortnox-sync";

export const runtime = "nodejs";

export async function POST() {
  const user = await resolveUser();
  if (!user) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Endast administratörer kan synka kostnadsställen" },
      { status: 403 },
    );
  }
  if (!(await getConnection())) {
    return NextResponse.json({ error: "Fortnox är inte anslutet." }, { status: 409 });
  }

  try {
    const token = await getValidAccessToken();
    const result = await syncCostCenters(token);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof FortnoxError && e.status === 403) {
      return NextResponse.json(
        {
          error:
            "Fortnox saknar behörighet för kostnadsställen. Koppla från och anslut igen för att ge appen 'costcenter'-behörighet.",
        },
        { status: 403 },
      );
    }
    const msg = e instanceof Error ? e.message : "Synk misslyckades";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
