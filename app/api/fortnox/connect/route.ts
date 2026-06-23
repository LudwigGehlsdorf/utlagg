// Start the Fortnox OAuth2 connect flow: redirect the admin's browser to
// Fortnox's consent screen. We stash an anti-CSRF `state` nonce in an httpOnly
// cookie and verify it on the callback.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { resolveUser } from "@/lib/current-user";
import { authorizeUrl, fortnoxConfigured } from "@/lib/fortnox";

export const STATE_COOKIE = "fortnox_oauth_state";

export async function GET() {
  const user = await resolveUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Endast administratörer kan ansluta Fortnox" },
      { status: 403 },
    );
  }
  if (!fortnoxConfigured()) {
    return NextResponse.json(
      { error: "Fortnox är inte konfigurerat på servern (saknar klient-id/secret)." },
      { status: 503 },
    );
  }

  const state = randomBytes(16).toString("hex");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 min — matches Fortnox's auth-code lifetime
  });

  return NextResponse.redirect(authorizeUrl(state));
}
