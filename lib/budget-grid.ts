// Spreadsheet grid index for the budget sheets.
//
// Every budget uses the same fixed 9-column layout: Konto, Beskrivning, six
// unnamed general-purpose columns (x1…x6), and Belopp (pinned last). Column
// letters (A, B, C…) are assigned left-to-right, so the six middle columns are
// C…H and Belopp is I. The general columns are "auto" typed — each cell is a
// number/percentage (and thus referenceable, e.g. =C5*D5) or, failing that,
// free text.
//
// References are stored bound to the row identity *and the field key* (not the
// letter), so they survive row reordering:
//   cell value    →  @L<lineItemId>:<fieldKey>   (fieldKey = expression | x1…x6)
//   account total →  account(<CC_CODE>, <ACCT_CODE>)
// Both round-trip back to a live A1 coordinate through this grid. The evaluator
// (lib/budget-eval.ts) understands both token forms.

import { effectiveKind, type AccountKind } from "./budget";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type ColKind = "konto" | "text" | "number" | "auto";

// The six fixed general-purpose columns between Beskrivning and Belopp.
export const EXTRA_COLUMN_KEYS = ["x1", "x2", "x3", "x4", "x5", "x6"] as const;

// One column in the final, ordered layout.
export interface ColumnDef {
  key: string;      // field key: konto | beskrivning | expression | <columnId>
  name: string;     // header label
  kind: ColKind;    // konto = account-only; text = free string; number = formula cell (referenceable)
  custom: boolean;  // true for user-defined columns (key === columnId)
  sortOrder: number;
  letter: string;   // assigned by position
}

// The fixed layout: Konto, Beskrivning, six general columns, Belopp (last).
const BUILTINS: Omit<ColumnDef, "letter">[] = [
  { key: "konto", name: "Konto", kind: "konto", custom: false, sortOrder: 0 },
  { key: "beskrivning", name: "Beskrivning", kind: "text", custom: false, sortOrder: 100 },
  ...EXTRA_COLUMN_KEYS.map((k, i) => ({ key: k, name: "", kind: "auto" as ColKind, custom: false, sortOrder: 200 + i * 100 })),
  { key: "expression", name: "Belopp", kind: "number", custom: false, sortOrder: 1_000_000 },
];

export const BELOPP_SORT = 1_000_000;

// The full ordered column list, with letters assigned by position.
export function orderedColumns(): ColumnDef[] {
  const merged = [...BUILTINS].sort((a, b) => a.sortOrder - b.sortOrder);
  return merged.map((c, i) => ({ ...c, letter: LETTERS[i] ?? "?" }));
}

// Map a built-in cell key to its A1 letter is done via the grid; the legacy
// single-letter suffix (.C/.D/.E from before custom columns) maps here.
function legacyField(s: string): string {
  return s === "C" ? "quantity" : s === "D" ? "unitPrice" : s === "E" ? "expression" : s;
}

// ── Grid (rows) ────────────────────────────────────────────────────

export interface GridLineItem { id: string }
export interface GridAccount { id: string; accountCode: string; kindOverride: AccountKind | null; lineItems: GridLineItem[] }
export interface GridSheet { code: string; accounts: GridAccount[] }

type RowKind = "section" | "account" | "line";
interface RowEntity { row: number; kind: RowKind; accountId?: string; accountCode?: string; lineId?: string }

export interface BudgetGrid {
  accountRow: Map<string, number>; // `${sheet}|${accountId}` → row (gutter)
  lineRow: Map<string, number>;    // `${sheet}|${lineId}` → row (gutter)
  rowAt: Map<string, RowEntity>;   // `${sheet}|${row}` → entity (A1 → token)
  lineLoc: Map<string, { sheet: string; row: number }>; // lineId → location (token → A1)
  acctCodeRow: Map<string, number>; // `${sheet}|${accountCode}` → row (token → A1)
  columns: ColumnDef[];
  letterToCol: Map<string, ColumnDef>;
  fieldToLetter: Map<string, string>;
  beloppLetter: string;
}

export function buildGrid(sheets: GridSheet[], columns: ColumnDef[]): BudgetGrid {
  const accountRow = new Map<string, number>();
  const lineRow = new Map<string, number>();
  const rowAt = new Map<string, RowEntity>();
  const lineLoc = new Map<string, { sheet: string; row: number }>();
  const acctCodeRow = new Map<string, number>();

  for (const sheet of sheets) {
    const code = sheet.code;
    let r = 0;
    const income = sheet.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "INCOME");
    const cost = sheet.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "COST");
    const emit = (accts: GridAccount[]) => {
      r++; rowAt.set(`${code}|${r}`, { row: r, kind: "section" });
      for (const a of accts) {
        r++;
        accountRow.set(`${code}|${a.id}`, r);
        acctCodeRow.set(`${code}|${a.accountCode}`, r);
        rowAt.set(`${code}|${r}`, { row: r, kind: "account", accountId: a.id, accountCode: a.accountCode });
        for (const li of a.lineItems) {
          r++;
          lineRow.set(`${code}|${li.id}`, r);
          lineLoc.set(li.id, { sheet: code, row: r });
          rowAt.set(`${code}|${r}`, { row: r, kind: "line", lineId: li.id, accountId: a.id, accountCode: a.accountCode });
        }
      }
    };
    emit(income);
    emit(cost);
  }

  const letterToCol = new Map<string, ColumnDef>();
  const fieldToLetter = new Map<string, string>();
  for (const c of columns) { letterToCol.set(c.letter, c); fieldToLetter.set(c.key, c.letter); }

  return {
    accountRow, lineRow, rowAt, lineLoc, acctCodeRow,
    columns, letterToCol, fieldToLetter,
    beloppLetter: fieldToLetter.get("expression") ?? "E",
  };
}

// ── A1 ⇄ internal token ────────────────────────────────────────────

const A1 = /^(?:([A-Za-z0-9_]+)!)?([A-Za-z])(\d+)$/;

export function a1ToToken(a1: string, currentSheet: string, grid: BudgetGrid): string | null {
  const m = A1.exec(a1.trim());
  if (!m) return null;
  const sheet = m[1] ?? currentSheet;
  const col = grid.letterToCol.get(m[2].toUpperCase());
  const row = parseInt(m[3], 10);
  const e = grid.rowAt.get(`${sheet}|${row}`);
  if (!col || !e) return null;
  if ((col.kind === "number" || col.kind === "auto") && e.kind === "line") return `@L${e.lineId}:${col.key}`;
  if (col.key === "expression" && e.kind === "account") return `account(${sheet}, ${e.accountCode})`;
  return null;
}

const TOKEN_LINE = /^@L([a-z0-9]+):([A-Za-z0-9]+)$/i;
const TOKEN_ACCT = /^account\(\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\)$/i;

export function tokenToA1(token: string, currentSheet: string, grid: BudgetGrid): string | null {
  let m = TOKEN_LINE.exec(token);
  if (m) {
    const loc = grid.lineLoc.get(m[1]);
    if (!loc) return null;
    const letter = grid.fieldToLetter.get(m[2]) ?? grid.fieldToLetter.get(legacyField(m[2]));
    if (!letter) return null;
    return (loc.sheet === currentSheet ? "" : `${loc.sheet}!`) + letter + loc.row;
  }
  m = TOKEN_ACCT.exec(token);
  if (m) {
    const sheet = m[1];
    const row = grid.acctCodeRow.get(`${sheet}|${m[2]}`);
    if (row === undefined) return null;
    return (sheet === currentSheet ? "" : `${sheet}!`) + grid.beloppLetter + row;
  }
  return null;
}

const A1_WORD = /(?<![A-Za-z0-9_!])((?:[A-Za-z0-9_]+!)?[A-Za-z]\d+)(?![A-Za-z0-9_])/g;
const TOKEN_WORD = /@L[a-z0-9]+:[A-Za-z0-9]+|account\(\s*[A-Za-z0-9_]+\s*,\s*[A-Za-z0-9_]+\s*\)/gi;

// What the user typed (A1) → what we store (field-bound tokens). Literals pass
// through. An A1 word that doesn't resolve to a real cell is left as-is.
export function toStored(raw: string, currentSheet: string, grid: BudgetGrid): string {
  const s = raw.trim();
  if (!s.startsWith("=")) return s;
  return "=" + s.slice(1).replace(A1_WORD, (whole) => a1ToToken(whole, currentSheet, grid) ?? whole);
}

// What we store (tokens) → what we show when editing (A1 coordinates).
export function toDisplay(stored: string, currentSheet: string, grid: BudgetGrid): string {
  const s = stored.trim();
  if (!s.startsWith("=")) return s;
  return "=" + s.slice(1).replace(TOKEN_WORD, (tok) => tokenToA1(tok, currentSheet, grid) ?? tok);
}
