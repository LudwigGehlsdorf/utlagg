// Pure helpers + constants shared across the budget sheets.
import type { DragEvent } from "react";
import { effectiveKind } from "@/lib/budget";
import type { BudgetCC, Evaluated } from "./budget-types";

export const RAMBUDGET = "__rambudget__";
export const VARS = "__vars__";
export const OTHER = "Övrigt";

// Parse an auto-column literal: a plain number or a percentage ("67%" → 0.67),
// else null (the value is free text). Accepts a Swedish comma decimal.
export function autoNumber(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (/^-?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  return null;
}

// True while the drag pointer is still inside the element's box. Used to keep a
// drop highlight from flashing: dragleave fires every time the pointer crosses
// onto a child element, so we only clear the highlight when it truly leaves.
export function insideRect(e: DragEvent): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
}

const numFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
export const fmt = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "" : numFmt.format(n);
export const fmtSigned = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "" : (n > 0 ? "+" : "") + numFmt.format(n);

// Income / cost split for one cost center under a given evaluation.
export function ccTotals(cc: BudgetCC, ev: Evaluated | undefined) {
  let income = 0, cost = 0;
  for (const a of cc.accounts) {
    const t = ev?.accounts[`${cc.costCenter.code}:${a.accountCode}`] ?? 0;
    if (effectiveKind(a.accountCode, a.kindOverride) === "INCOME") income += t; else cost += t;
  }
  return { income, cost, result: income - cost };
}
