// Shared budget domain helpers (pure — safe in both server and client).

export type AccountKind = "INCOME" | "COST";

// BAS chart: 3xxx accounts are revenue (intäkter); everything else is a cost.
export function inferKind(accountCode: string): AccountKind {
  return /^3/.test(accountCode.trim()) ? "INCOME" : "COST";
}

// The effective kind: an explicit override wins over the code-based inference.
export function effectiveKind(
  accountCode: string,
  override: AccountKind | null | undefined,
): AccountKind {
  return override ?? inferKind(accountCode);
}
