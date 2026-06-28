// Shared types for the budget revision view (mirror the API response).
import type { ReactNode } from "react";
import type { AccountKind } from "@/lib/budget";

export interface LineItem {
  id: string; description: string;
  expression: string; // the Belopp cell — a literal number or "=…" formula
  sortOrder: number;
  values: Record<string, string>; // per-line values for the six general columns, keyed x1…x6
}

// A buffered new-row / variable draft.
export interface Draft { description: string; expression: string }
export interface Comment { id: string; body: string; createdAt: string; author: { id: string; name: string } }
export interface Account {
  id: string; accountCode: string; accountName: string; sortOrder: number;
  kindOverride: AccountKind | null;
  lineItems: LineItem[]; comments: Comment[];
}
export interface BudgetCC { id: string; sortOrder: number; costCenter: { id: string; code: string; name: string; committee: string | null }; accounts: Account[] }
export interface Variable { id: string; name: string; expression: string; sortOrder: number }
export interface Evaluated {
  vars: Record<string, number>; accounts: Record<string, number>; lineItems: Record<string, number>;
  cells: Record<string, number>; badLineItems: string[]; badVariables: string[]; errors: string[];
}
export interface Revision {
  id: string; name: string; budgetId: string;
  createdBy: { name: string }; clonedFrom: { id: string; name: string } | null;
  budget: { id: string; year: number; name: string; baselineRevisionId: string | null };
  variables: Variable[]; costCenters: BudgetCC[]; evaluated: Evaluated;
  // Actual outcome from the Fortnox ledger, keyed `${ccCode}:${accountCode}` (SEK).
  actuals?: Record<string, number>; actualsSynced?: boolean; actualsYear?: number;
}

// A reloading API call (PATCH/POST/DELETE then refetch). Returns ok.
export type ApiFn = (url: string, method: string, body?: unknown) => Promise<boolean>;

export interface CellArgs {
  id: string; field: string; actual: string; className?: string; placeholder?: string; mono?: boolean;
  url: string; payload: (v: string) => Record<string, unknown>;
  gated?: boolean; // budget-sheet cell: navigable + read-only until edit mode
}
export type CellFn = (a: CellArgs) => ReactNode;

export interface FormulaArgs {
  id: string; field: string; raw: string; computed: number | undefined; sheet: string;
  bad?: boolean; placeholder?: string; url: string; payload: (v: string) => Record<string, unknown>; className?: string;
  // "value" (default): show the evaluated value when idle, formula on focus.
  // "formula": always show the formula (used where a separate value column exists).
  display?: "value" | "formula";
  gated?: boolean;
}
export type FormulaFn = (a: FormulaArgs) => ReactNode;

export interface AutoArgs {
  id: string; field: string; raw: string; computed: number | undefined; sheet: string;
  placeholder?: string; url: string; payload: (v: string) => Record<string, unknown>;
  gated?: boolean;
}
export type AutoFn = (a: AutoArgs) => ReactNode;
