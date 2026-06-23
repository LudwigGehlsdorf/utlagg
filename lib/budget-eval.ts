// Expression evaluator for budget line items and variables.
//
// Syntax supported:
//   number literals:  1500  /  2_000.50
//   arithmetic:       +  -  *  /  (grouped with parentheses)
//   variable refs:    MEMBERS  /  TICKET_PRICE
//   account totals:   account(CC_CODE, ACCT_CODE)
//
// Evaluation uses fixed-point iteration so variables that reference account
// totals (which in turn depend on line items that reference variables) resolve
// correctly across cost centers. Circular dependencies are detected by a pass
// limit and surfaced as NaN.

export type AccountTotals = Map<string, number>; // "CC_CODE:ACCT_CODE" → SEK
export type VarValues    = Map<string, number>;  // variable name → SEK

// ── Tokeniser ──────────────────────────────────────────────────────

type TokKind = "num" | "id" | "op" | "lparen" | "rparen" | "comma" | "eof";
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

// ── Public API ─────────────────────────────────────────────────────

export interface LineItemInput {
  id: string;
  accountKey: string; // "CC_CODE:ACCT_CODE"
  expression: string;
  // When both are present the value is `quantity * unitPrice` (the
  // "antal × á-pris" form); otherwise `expression` is evaluated directly.
  quantity?: string | null;
  unitPrice?: string | null;
}

// A line item's value: quantity × unitPrice when both sides are given,
// else the standalone expression.
function lineItemValue(li: LineItemInput, vars: VarValues, accounts: AccountTotals): number {
  const q = li.quantity?.trim();
  const u = li.unitPrice?.trim();
  if (q && u) return evalExpr(q, vars, accounts) * evalExpr(u, vars, accounts);
  return evalExpr(li.expression, vars, accounts);
}

export interface VariableInput {
  name: string;
  expression: string;
}

export interface EvalResult {
  vars: VarValues;           // variable name → evaluated SEK value
  accounts: AccountTotals;   // "CC:ACCT" → sum of line items (SEK)
  lineItems: Map<string, number>; // lineItem.id → evaluated SEK value
  errors: string[];          // human-readable warnings (circular etc.)
}

export function evaluate(
  variables: VariableInput[],
  lineItems: LineItemInput[],
  maxPasses = 6,
): EvalResult {
  const vars: VarValues     = new Map();
  const accounts: AccountTotals = new Map();
  const liValues: Map<string, number> = new Map();
  const errors: string[] = [];

  let pass = 0;
  let stable = false;

  while (!stable && pass < maxPasses) {
    pass++;
    const prevVars    = new Map(vars);
    const prevAccts   = new Map(accounts);

    // Step 1: evaluate line items using current var + account values
    for (const li of lineItems) {
      const val = lineItemValue(li, vars, accounts);
      liValues.set(li.id, Number.isFinite(val) ? val : 0);
    }

    // Step 2: sum line items into account totals
    accounts.clear();
    for (const li of lineItems) {
      const cur = accounts.get(li.accountKey) ?? 0;
      accounts.set(li.accountKey, cur + (liValues.get(li.id) ?? 0));
    }

    // Step 3: evaluate variables in declaration order (later vars can ref earlier)
    for (const v of variables) {
      const val = evalExpr(v.expression, vars, accounts);
      vars.set(v.name, Number.isFinite(val) ? val : 0);
    }

    // Check convergence
    stable =
      [...vars.entries()].every(([k, v]) => prevVars.get(k) === v) &&
      [...accounts.entries()].every(([k, v]) => prevAccts.get(k) === v);
  }

  if (!stable) {
    errors.push("Budgeten har cirkulära beroenden — vissa värden kan vara felaktiga.");
  }

  return { vars, accounts, lineItems: liValues, errors };
}
