// Fortnox OAuth2 redirect target. Verifies the state nonce, exchanges the
// authorization code for tokens, fetches the company name, persists the
// connection, and bounces back to the bookkeeping page with a status flag.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveUser } from "@/lib/current-user";
import {
  exchangeCode,
  getCompanyName,
  saveConnection,
  FortnoxError,
} from "@/lib/fortnox";
import { STATE_COOKIE } from "../connect/route";

function back(req: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/bookkeeping", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (error) {
    return back(req, { fortnox: "error", reason: error });
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return back(req, { fortnox: "error", reason: "invalid_state" });
  }

  // Only an admin should be completing the connect flow.
  const user = await resolveUser();
  if (!user || user.role !== "ADMIN") {
    return back(req, { fortnox: "error", reason: "forbidden" });
  }

  try {
    const token = await exchangeCode(code);
    const companyName = await getCompanyName(token.access_token);
    await saveConnection(token, { connectedById: user.id, companyName });
    return back(req, { fortnox: "connected" });
  } catch (e) {
    const reason = e instanceof FortnoxError ? e.message : "token_exchange_failed";
    return back(req, { fortnox: "error", reason });
  }
}
