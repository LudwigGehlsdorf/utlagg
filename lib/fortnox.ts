// Fortnox integration: OAuth2 (authorization-code flow) + the slice of the REST
// API we need to push booked vouchers (verifikationer) and attach receipts.
//
// Fortnox killed the legacy fixed-API-key auth in April 2025, so this is pure
// OAuth2. We hold one service connection for the whole section (the org books
// into a single Fortnox company) in the FortnoxConnection table. The access
// token lives ~1h; the refresh token is long-lived (~45 days) but ROTATES on
// every refresh, so each refresh persists the new pair.
import { prisma } from "@/lib/db";

const AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";

// Scopes (exact Fortnox tokens): vouchers (bookkeeping), cost centres, voucher
// file upload + attach (connectfile — this also covers the inbox upload), and
// company name for display. NB: "archive"/"inbox" are NOT valid scope tokens —
// requesting them yields invalid_scope.
export const FORTNOX_SCOPES = "bookkeeping inbox connectfile costcenter";

// Refresh this many ms before the token actually expires, to avoid racing the
// clock on a slow request.
const EXPIRY_SKEW_MS = 60_000;

export class FortnoxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FortnoxError";
  }
}

// ── Config ────────────────────────────────────────────────────────

interface FortnoxConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function fortnoxConfigured(): boolean {
  return Boolean(
    process.env.FORTNOX_CLIENT_ID &&
      process.env.FORTNOX_CLIENT_SECRET &&
      process.env.FORTNOX_REDIRECT_URI,
  );
}

function getConfig(): FortnoxConfig {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  const redirectUri = process.env.FORTNOX_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new FortnoxError(
      "Fortnox är inte konfigurerat (saknar FORTNOX_CLIENT_ID/SECRET/REDIRECT_URI).",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// ── OAuth ─────────────────────────────────────────────────────────

// The URL the admin's browser is sent to, to grant our app access to their
// Fortnox company. `state` is an anti-CSRF nonce we verify on the callback.
export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: FORTNOX_SCOPES,
    state,
    access_type: "offline", // required to receive a refresh token
    account_type: "service", // a service connection, not tied to one Fortnox user
    response_type: "code",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getConfig();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json.error_description || json.error || `Token-förfrågan misslyckades (${res.status})`;
    throw new FortnoxError(String(msg), res.status);
  }
  return json as TokenResponse;
}

// Exchange the authorization code from the callback for the first token pair.
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { redirectUri } = getConfig();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

// ── Connection (token storage) ────────────────────────────────────

// The single stored connection, if any. Treated as a singleton.
export function getConnection() {
  return prisma.fortnoxConnection.findFirst({ orderBy: { createdAt: "desc" } });
}

// Persist a freshly-obtained token pair as THE connection, replacing any
// previous one (only one Fortnox company is ever connected).
export async function saveConnection(
  token: TokenResponse,
  opts: { connectedById?: string | null; companyName?: string | null },
) {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  return prisma.$transaction(async (tx) => {
    await tx.fortnoxConnection.deleteMany({});
    return tx.fortnoxConnection.create({
      data: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        scopes: token.scope || FORTNOX_SCOPES,
        tokenType: token.token_type || "Bearer",
        companyName: opts.companyName ?? null,
        connectedById: opts.connectedById ?? null,
      },
    });
  });
}

export async function disconnect(): Promise<void> {
  await prisma.fortnoxConnection.deleteMany({});
}

// Return a usable access token, refreshing (and persisting the rotated pair)
// if the current one is at/near expiry. Throws if there's no connection.
//
// Note: refresh-token rotation means concurrent refreshes could race and
// invalidate each other. For a single-bookkeeper section this is a non-issue;
// if exports ever run concurrently this needs a lock around the refresh.
export async function getValidAccessToken(): Promise<string> {
  const conn = await getConnection();
  if (!conn) {
    throw new FortnoxError("Fortnox är inte anslutet.", 409);
  }
  if (conn.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return conn.accessToken;
  }
  // Expired (or about to) — refresh and persist the rotated tokens.
  const token = await refreshTokens(conn.refreshToken);
  await prisma.fortnoxConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope || conn.scopes,
    },
  });
  return token.access_token;
}

// ── REST helpers ──────────────────────────────────────────────────

// Pull a human-readable message out of Fortnox's error envelope.
function fortnoxErrorMessage(json: unknown, status: number): string {
  const info = (json as { ErrorInformation?: { message?: string; Message?: string } })
    ?.ErrorInformation;
  return info?.message || info?.Message || `Fortnox-fel (${status})`;
}

async function fortnoxGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  return json as T;
}

async function fortnoxPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  return json as T;
}

import { decodeCp437 } from "@/lib/sie";

// ── Read side: financial years + SIE ledger export ────────────────

export interface FortnoxFinancialYear {
  id: number;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
}

export async function listFinancialYears(token: string): Promise<FortnoxFinancialYear[]> {
  const data = await fortnoxGet<{
    FinancialYears?: { Id: number; FromDate: string; ToDate: string }[];
  }>("/financialyears", token);
  return (data.FinancialYears ?? []).map((y) => ({
    id: y.Id,
    fromDate: y.FromDate,
    toDate: y.ToDate,
  }));
}

// Download the SIE type-4 (transactions) export for one financial year and
// decode it from CP437 to a normal JS string. This is the whole ledger for the
// year in a single request.
export async function fetchSie(token: string, financialYearId: number): Promise<string> {
  const res = await fetch(`${API_BASE}/sie/4?financialyear=${financialYearId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  }
  return decodeCp437(Buffer.from(await res.arrayBuffer()));
}

// ── Domain operations ─────────────────────────────────────────────

export interface FortnoxCostCenter {
  code: string;
  description: string;
  active: boolean;
}

// List the company's cost centres (requires the `costcenter` scope). These are
// the only cost centres selectable when creating an expense.
export async function listCostCenters(token: string): Promise<FortnoxCostCenter[]> {
  const data = await fortnoxGet<{
    CostCenters?: { Code: string; Description?: string; Active?: boolean }[];
  }>("/costcenters", token);
  return (data.CostCenters ?? []).map((c) => ({
    code: c.Code,
    description: c.Description ?? c.Code,
    active: c.Active ?? true,
  }));
}

export async function getCompanyName(token: string): Promise<string | null> {
  try {
    const data = await fortnoxGet<{ CompanyInformation?: { CompanyName?: string } }>(
      "/companyinformation",
      token,
    );
    return data.CompanyInformation?.CompanyName ?? null;
  } catch {
    return null; // company name is cosmetic — never block connect on it
  }
}

export interface VoucherRowInput {
  account: number;
  debit: number; // SEK (decimal)
  credit: number; // SEK (decimal)
  costCenter?: string; // Fortnox cost-centre code
  description?: string;
}

export interface CreatedVoucher {
  series: string;
  number: number;
  year: number;
}

// POST a verifikation. Amounts are decimal SEK (Fortnox does not use öre).
export async function createVoucher(
  token: string,
  input: {
    series: string;
    date: string; // YYYY-MM-DD
    description: string;
    rows: VoucherRowInput[];
  },
): Promise<CreatedVoucher> {
  const VoucherRows = input.rows.map((r) => {
    const row: Record<string, unknown> = { Account: r.account };
    if (r.debit > 0) row.Debit = r.debit;
    if (r.credit > 0) row.Credit = r.credit;
    if (r.costCenter) row.CostCenter = r.costCenter;
    if (r.description) row.TransactionInformation = r.description.slice(0, 100);
    return row;
  });

  const data = await fortnoxPost<{
    Voucher?: { VoucherSeries?: string; VoucherNumber?: number; Year?: number };
  }>("/vouchers", token, {
    Voucher: {
      VoucherSeries: input.series,
      TransactionDate: input.date,
      Description: input.description.slice(0, 200),
      VoucherRows,
    },
  });

  const v = data.Voucher;
  if (!v?.VoucherSeries || v.VoucherNumber == null) {
    throw new FortnoxError("Fortnox returnerade ingen verifikation.");
  }
  return { series: v.VoucherSeries, number: v.VoucherNumber, year: v.Year ?? new Date().getFullYear() };
}

// Upload a receipt to the Fortnox inbox, returning the new File id.
export async function uploadInboxFile(
  token: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  // path=Inbox_v targets the dedicated voucher inbox folder.
  const res = await fetch(`${API_BASE}/inbox?path=Inbox_v`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as { File?: { Id?: string }; Id?: string };
  if (!res.ok) throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  const id = json.File?.Id ?? json.Id;
  if (!id) throw new FortnoxError("Fortnox returnerade inget fil-id vid uppladdning.");
  return id;
}

// Attach an uploaded file to a created voucher.
export async function connectFileToVoucher(
  token: string,
  fileId: string,
  series: string,
  number: number,
): Promise<void> {
  await fortnoxPost("/voucherfileconnections", token, {
    VoucherFileConnection: {
      FileId: fileId,
      VoucherSeries: series,
      VoucherNumber: number,
    },
  });
}
