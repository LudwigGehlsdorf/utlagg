// Expression evaluator for budget line items and variables.
//
// A cell is read like a spreadsheet cell:
//   • no leading "="           → a literal number  (350  →  350)
//   • leading "="              → a formula         (=350*2  →  700)
//   • anything else (text)     → an error (NaN)
//
// Formula syntax (after the "="):
//   number literals:  1500  /  2_000.50
//   arithmetic:       +  -  *  /  (grouped with parentheses)
//   variable refs:    MEMBERS  /  TICKET_PRICE
//   account totals:   account(CC_CODE, ACCT_CODE)
//   cell refs:        @L<lineItemId>.<C|D|E>   (the row-bound form of an A1
//                     reference like =E5; see lib/budget-grid.ts)
//
// Evaluation uses fixed-point iteration so references that chain through
// variables, account totals and other cells resolve across cost centres.
// Circular dependencies are caught by a pass limit and surfaced as NaN.

export type AccountTotals = Map<string, number>; // "CC_CODE:ACCT_CODE" → SEK
export type VarValues    = Map<string, number>;  // variable name → SEK
export type CellValues   = Map<string, number>;  // "<lineItemId>.<col>" → SEK

// ── Tokeniser ──────────────────────────────────────────────────────

type TokKind = "num" | "id" | "ref" | "op" | "lparen" | "rparen" | "comma" | "eof";
interface Tok { kind: TokKind; val: string }

function tokenise(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let num = "";
      while (i < src.length && /[0-9._]/.test(src[i])) num += src[i++];
      toks.push({ kind: "num", val: num.replace(/_/g, "") });
    } else if (ch === "@") {
      // Row-bound cell reference: @L<lineItemId>:<fieldKey> (legacy: .<col>)
      i++;
      let ref = "";
      while (i < src.length && /[A-Za-z0-9.:]/.test(src[i])) ref += src[i++];
      toks.push({ kind: "ref", val: ref });
    } else if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) id += src[i++];
      toks.push({ kind: "id", val: id });
    } else if ("+-*/×÷".includes(ch)) {
      // Accept the typographic ×/÷ as aliases for * and /.
      const op = ch === "×" ? "*" : ch === "÷" ? "/" : ch;
      toks.push({ kind: "op", val: op }); i++;
    } else if (ch === "(") {
      toks.push({ kind: "lparen", val: "(" }); i++;
    } else if (ch === ")") {
      toks.push({ kind: "rparen", val: ")" }); i++;
    } else if (ch === ",") {
      toks.push({ kind: "comma", val: "," }); i++;
    } else {
      i++; // skip unknown characters
    }
  }
  toks.push({ kind: "eof", val: "" });
  return toks;
}

// ── Recursive-descent parser / evaluator ───────────────────────────

function evalExpr(
  src: string,
  vars: VarValues,
  accounts: AccountTotals,
  cells: CellValues,
): number {
  const toks = tokenise(src);
  let pos = 0;

  const peek = () => toks[pos];
  const consume = () => toks[pos++];

  function parseExpr(): number { return parseAddSub(); }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek().kind === "op" && (peek().val === "+" || peek().val === "-")) {
      const op = consume().val;
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (peek().kind === "op" && (peek().val === "*" || peek().val === "/")) {
      const op = consume().val;
      const right = parseUnary();
      left = op === "*" ? left * right : right === 0 ? NaN : left / right;
    }
    return left;
  }

  function parseUnary(): number {
    if (peek().kind === "op" && peek().val === "-") {
      consume();
      return -parseAtom();
    }
    return parseAtom();
  }

  function parseAtom(): number {
    const t = peek();
    if (t.kind === "num") {
      consume();
      return parseFloat(t.val);
    }
    if (t.kind === "ref") {
      consume();
      // val is "L<lineItemId>:<fieldKey>"; the cell map is keyed
      // "<lineItemId>:<fieldKey>". Legacy "<id>.<C|D|E>" maps to field keys.
      let key = t.val.startsWith("L") ? t.val.slice(1) : t.val;
      if (key.includes(".")) {
        const dot = key.lastIndexOf(".");
        const col = key.slice(dot + 1);
        key = key.slice(0, dot) + ":" + (col === "C" ? "quantity" : col === "D" ? "unitPrice" : col === "E" ? "expression" : col);
      }
      const v = cells.get(key);
      return v !== undefined ? v : NaN;
    }
    if (t.kind === "lparen") {
      consume();
      const v = parseExpr();
      if (peek().kind === "rparen") consume();
      return v;
    }
    if (t.kind === "id") {
      consume();
      const name = t.val;
      // Built-in function: account(CC_CODE, ACCT_CODE)
      if (name === "account" && peek().kind === "lparen") {
        consume(); // (
        const cc = peek().kind === "id" ? consume().val : "";
        if (peek().kind === "comma") consume();
        const acct = peek().kind === "id" || peek().kind === "num"
          ? consume().val
          : "";
        if (peek().kind === "rparen") consume();
        return accounts.get(`${cc}:${acct}`) ?? 0;
      }
      // Variable reference
      const v = vars.get(name);
      return v !== undefined ? v : NaN;
    }
    return NaN;
  }

  const result = parseExpr();
  return Number.isFinite(result) ? result : NaN;
}

// A spreadsheet cell: literal number unless it starts with "=", in which case
// the rest is a formula. Empty / non-numeric text → NaN.
function evalCell(
  raw: string | null | undefined,
  vars: VarValues,
  accounts: AccountTotals,
  cells: CellValues,
): number {
  const s = (raw ?? "").trim();
  if (!s) return NaN;
  if (s.startsWith("=")) return evalExpr(s.slice(1), vars, accounts, cells);
  // A trailing % is a fraction: "67%" → 0.67.
  if (s.endsWith("%")) {
    const p = Number(s.slice(0, -1).replace(/[\s_]/g, "").replace(",", "."));
    return Number.isFinite(p) ? p / 100 : NaN;
  }
  const n = Number(s.replace(/_/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

// ── Public API ─────────────────────────────────────────────────────

export interface LineItemInput {
  id: string;
  accountKey: string; // "CC_CODE:ACCT_CODE"
  expression: string; // the Belopp cell — a literal number or "=…" formula
  // Per-line values for user-defined columns: { [columnId]: string }.
  values?: Record<string, string> | null;
}

export interface VariableInput {
  name: string;
  expression: string;
}

export interface EvalResult {
  vars: VarValues;           // variable name → evaluated SEK value
  accounts: AccountTotals;   // "CC:ACCT" → sum of line items (SEK)
  lineItems: Map<string, number>; // lineItem.id → evaluated SEK value
  cells: CellValues;         // "<lineItemId>:<fieldKey>" → evaluated SEK value
  badLineItems: string[];    // ids whose cell didn't resolve (formula error)
  badVariables: string[];    // variable names that didn't resolve
  errors: string[];          // human-readable warnings (circular etc.)
}

export function evaluate(
  variables: VariableInput[],
  lineItems: LineItemInput[],
  // The general columns (x1…x6) whose per-line values are evaluated into cells
  // so they can be referenced (numbers/percentages) by other formulas.
  extraColumnKeys: string[] = [],
  maxPasses = 8,
): EvalResult {
  const vars: VarValues     = new Map();
  const accounts: AccountTotals = new Map();
  const cells: CellValues   = new Map();
  const liValues: Map<string, number> = new Map();
  const errors: string[] = [];

  let pass = 0;
  let stable = false;

  while (!stable && pass < maxPasses) {
    pass++;
    const prevVars    = new Map(vars);
    const prevAccts   = new Map(accounts);

    // Step 1: evaluate line items + their cells using current var/account/cell values
    for (const li of lineItems) {
      const value = evalCell(li.expression, vars, accounts, cells);
      liValues.set(li.id, Number.isFinite(value) ? value : 0);
      // Cell map keeps finite numbers (0 for unresolved) so the fixed point
      // stays stable; the bad-cell set below tracks the actual errors. Keyed by
      // field so refs survive column reorders.
      cells.set(`${li.id}:expression`, Number.isFinite(value) ? value : 0);
      for (const colId of extraColumnKeys) {
        const cv = evalCell(li.values?.[colId], vars, accounts, cells);
        cells.set(`${li.id}:${colId}`, Number.isFinite(cv) ? cv : 0);
      }
    }

    // Step 2: sum line items into account totals
    accounts.clear();
    for (const li of lineItems) {
      const cur = accounts.get(li.accountKey) ?? 0;
      accounts.set(li.accountKey, cur + (liValues.get(li.id) ?? 0));
    }

    // Step 3: evaluate variables in declaration order (later vars can ref earlier)
    for (const v of variables) {
      const val = evalCell(v.expression, vars, accounts, cells);
      vars.set(v.name, Number.isFinite(val) ? val : 0);
    }

    // Check convergence
    stable =
      [...vars.entries()].every(([k, v]) => prevVars.get(k) === v) &&
      [...accounts.entries()].every(([k, v]) => prevAccts.get(k) === v);
  }

  // Final pass to flag cells/variables that don't resolve (after convergence).
  const badLineItems: string[] = [];
  for (const li of lineItems) {
    const value = evalCell(li.expression, vars, accounts, cells);
    if (!Number.isFinite(value)) badLineItems.push(li.id);
  }
  const badVariables: string[] = [];
  for (const v of variables) {
    const val = evalCell(v.expression, vars, accounts, cells);
    if (!Number.isFinite(val)) badVariables.push(v.name);
  }

  if (!stable) {
    errors.push("Budgeten har cirkulära beroenden — vissa värden kan vara felaktiga.");
  }

  return { vars, accounts, lineItems: liValues, cells, badLineItems, badVariables, errors };
}
