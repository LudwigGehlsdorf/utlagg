// Fortnox connection status (GET) and disconnect (DELETE).
import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/current-user";
import { disconnect, fortnoxConfigured, getConnection } from "@/lib/fortnox";

export async function GET() {
  const user = await resolveUser();
  if (!user) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });

  const conn = await getConnection();
  return NextResponse.json({
    configured: fortnoxConfigured(),
    connected: Boolean(conn),
    companyName: conn?.companyName ?? null,
    voucherSeries: conn?.voucherSeries ?? null,
    expiresAt: conn?.expiresAt?.toISOString() ?? null,
  });
}

export async function DELETE() {
  const user = await resolveUser();
  if (!user) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Endast administratörer kan koppla från Fortnox" },
      { status: 403 },
    );
  }
  await disconnect();
  return NextResponse.json({ ok: true });
}
