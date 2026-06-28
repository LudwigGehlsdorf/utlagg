// The per-cost-centre sheet: Intäkter / Kostnader as two rounded cards, each an
// account → line-items → Summa table. Owns the drag-reclassify + row-reorder
// drag handlers and the spreadsheet keyboard navigation. The cell renderers,
// `api`, and edit-mode state are passed in from the revision client.
import { useRef, useState } from "react";
import { effectiveKind, type AccountKind } from "@/lib/budget";
import { type BudgetGrid, type ColumnDef } from "@/lib/budget-grid";
import { cn } from "@/lib/utils";
import { ccTotals, fmt, fmtSigned, insideRect } from "./budget-helpers";
import type { Account, BudgetCC, Evaluated, LineItem, Draft, CellFn, FormulaFn, AutoFn, ApiFn } from "./budget-types";

export function CostCenterSheet(props: {
  cc: BudgetCC; ccCode: string; ev: Evaluated; grid: BudgetGrid; columns: ColumnDef[];
  isAdmin: boolean; canComment: boolean; userId: string;
  renderCell: CellFn; renderFormula: FormulaFn; renderAuto: AutoFn; api: ApiFn; revisionId: string;
  editing: boolean; setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  openComments: Set<string>; setOpenComments: React.Dispatch<React.SetStateAction<Set<string>>>;
  commentDraft: Record<string, string>; setCommentDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  newRow: Record<string, Draft>;
  setNewRow: React.Dispatch<React.SetStateAction<Record<string, Draft>>>;
  createLine: (accountId: string) => Promise<void>;
}) {
  const { cc, ccCode, ev, grid, columns, isAdmin, canComment, userId, renderCell, renderFormula, renderAuto, api, revisionId, editing, setEditing,
    openComments, setOpenComments, commentDraft, setCommentDraft, newRow, setNewRow, createLine } = props;
  const badLine = new Set(ev.badLineItems ?? []);
  const gut = (n: number | undefined) => <td className="select-none border-r border-border/60 px-1 text-right align-top font-mono text-[10px] leading-8 text-muted/50">{n ?? ""}</td>;

  const income = cc.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "INCOME");
  const cost = cc.accounts.filter((a) => effectiveKind(a.accountCode, a.kindOverride) === "COST");
  const totals = ccTotals(cc, ev);

  // Column geometry. The table is: gutter + every column + action.
  const totalCols = columns.length + 2;            // for full-width spanners (comments)
  const liUrl = (id: string) => `/api/budgets/line-items/${id}`;

  // ── Column widths ─────────────────────────────────────────────────
  // Fixed widths; Beskrivning is left elastic so it fills the row. The table is
  // w-full, so it always fits its container with no horizontal scrollbar.
  const GUT_W = 40, ACT_W = 64;
  const staticWidth = (c: ColumnDef): number | undefined =>
    c.key === "beskrivning" ? undefined : c.key === "konto" ? 130 : c.key === "expression" ? 130 : 96;

  // One line-item cell, rendered per column.
  function lineCell(col: ColumnDef, li: LineItem) {
    const k = col.key;
    if (k === "konto") return (
      <td key={k} className="border-r border-border/60 p-0">
        {isAdmin && (
          <span
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("lineId", li.id); e.dataTransfer.effectAllowed = "move"; }}
            className="flex cursor-grab select-none items-center px-1.5 py-1.5 text-muted/30 opacity-0 transition-opacity hover:text-muted active:cursor-grabbing group-hover:opacity-100"
            title="Dra för att ändra ordning"
          >⠿</span>
        )}
      </td>
    );
    if (k === "beskrivning")
      return <td key={k} className="border-r border-border/60 p-0">{renderCell({ id: li.id, field: "description", actual: li.description, className: "pl-5 text-muted", placeholder: "Beskrivning", url: liUrl(li.id), payload: (v) => ({ description: v }), gated: true })}</td>;
    if (k === "expression") {
      const val = ev.lineItems[li.id];
      return <td key={k} className="border-r border-border/60 p-0 text-right">{renderFormula({ id: li.id, field: "expression", raw: li.expression, computed: val, sheet: ccCode, bad: badLine.has(li.id), placeholder: "0", url: liUrl(li.id), payload: (v) => ({ expression: v }), gated: true })}</td>;
    }
    // One of the six general columns (x1…x6): auto-typed.
    return <td key={k} className="border-r border-border/60 p-0">{renderAuto({ id: li.id, field: `col:${k}`, raw: li.values?.[k] ?? "", computed: ev.cells?.[`${li.id}:${k}`], sheet: ccCode, placeholder: "", url: liUrl(li.id), payload: (v) => ({ columnValues: { [k]: v } }), gated: true })}</td>;
  }

  const draft = (id: string): Draft => newRow[id] ?? { description: "", expression: "" };
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setNewRow((m) => ({ ...m, [id]: { ...draft(id), ...patch } }));

  // Per-section "+ nytt konto" drafts and the live drag-reclassify target.
  const [acctDraft, setAcctDraft] = useState<Record<AccountKind, { code: string; name: string }>>({ INCOME: { code: "", name: "" }, COST: { code: "", name: "" } });
  const [dropKind, setDropKind] = useState<AccountKind | null>(null);

  async function createAccount(kind: AccountKind) {
    const d = acctDraft[kind];
    if (!d.code.trim()) return;
    const ok = await api(`/api/budgets/revisions/${revisionId}/cost-centers/${cc.id}/accounts`, "POST", {
      accountCode: d.code.trim(), accountName: d.name.trim(), kindOverride: kind,
    });
    if (ok) setAcctDraft((s) => ({ ...s, [kind]: { code: "", name: "" } }));
  }

  // Dropping an account card flips its income/cost classification. Gated on the
  // "accountid" drag payload so it ignores line-row drags (which carry "lineid").
  const dropProps = (kind: AccountKind) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("accountid")) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropKind !== kind) setDropKind(kind); },
    onDragLeave: (e: React.DragEvent) => { if (insideRect(e)) return; setDropKind((k) => (k === kind ? null : k)); },
    onDrop: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("accountid")) return; e.preventDefault(); setDropKind(null); const id = e.dataTransfer.getData("accountId"); if (id) api(`/api/budgets/accounts/${id}`, "PATCH", { kindOverride: kind }); },
  });

  // Which line row is the current drop target (for the insert highlight).
  const [dropLineId, setDropLineId] = useState<string | null>(null);

  // Reorder a line within its account: drop `draggedId` at `targetId`'s slot.
  // Same-account only; cross-account ids are ignored by the endpoint.
  function reorderLine(account: Account, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    if (!account.lineItems.some((l) => l.id === draggedId)) return; // not this account's row
    const ids = account.lineItems.map((l) => l.id).filter((id) => id !== draggedId);
    const idx = ids.indexOf(targetId);
    if (idx === -1) return;
    ids.splice(idx, 0, draggedId);
    api(`/api/budgets/accounts/${account.id}/line-items/reorder`, "POST", { orderedIds: ids });
  }
  const lineDropProps = (account: Account, li: LineItem) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("lineid")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (dropLineId !== li.id) setDropLineId(li.id); },
    onDragLeave: (e: React.DragEvent) => { if (insideRect(e)) return; setDropLineId((k) => (k === li.id ? null : k)); },
    onDrop: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes("lineid")) return; e.preventDefault(); e.stopPropagation(); setDropLineId(null); reorderLine(account, e.dataTransfer.getData("lineId"), li.id); },
  });

  // ── Spreadsheet keyboard navigation ───────────────────────────────
  // A cell is "selected" when focused. Arrow keys / Tab move the selection; the
  // cell only enters edit mode on Enter / F2 / double-click (until then keystrokes
  // are swallowed). Movement is geometric over the [data-cell] inputs, so it spans
  // account-header cells and crosses from the Intäkter card into Kostnader.
  const sheetRef = useRef<HTMLDivElement>(null);
  type Dir = "up" | "down" | "left" | "right";
  function navFrom(key: string, dir: Dir) {
    const root = sheetRef.current;
    const cur = root?.querySelector<HTMLElement>(`[data-cell="${key}"]`);
    if (!root || !cur) return;
    const a = cur.getBoundingClientRect();
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    const cands: { el: HTMLElement; score: number }[] = [];
    root.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
      if (el === cur) return;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - acx, dy = r.top + r.height / 2 - acy;
      let primary: number, cross: number;
      if (dir === "down") { if (dy <= 2) return; primary = dy; cross = Math.abs(dx); }
      else if (dir === "up") { if (dy >= -2) return; primary = -dy; cross = Math.abs(dx); }
      else if (dir === "right") { if (dx <= 2) return; primary = dx; cross = Math.abs(dy); }
      else { if (dx >= -2) return; primary = -dx; cross = Math.abs(dy); }
      cands.push({ el, score: primary + cross * 4 }); // bias toward the same column/row
    });
    cands.sort((x, y) => x.score - y.score);
    cands[0]?.el.focus();
  }
  function onSheetKeyDown(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    const key = t.dataset?.cell;
    if (!key) return; // not a navigable cell (e.g. an add-row input)
    const input = t as HTMLInputElement;
    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); input.blur(); setEditing(false); requestAnimationFrame(() => navFrom(key, e.shiftKey ? "up" : "down")); }
      else if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); input.blur(); setEditing(false); requestAnimationFrame(() => navFrom(key, e.shiftKey ? "left" : "right")); }
      else if (e.key === "Escape") { setEditing(false); } // input's own Escape reverts
      return; // other keys edit the text
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave shortcuts alone
    if (e.key.startsWith("Arrow")) { e.preventDefault(); e.stopPropagation(); navFrom(key, e.key.slice(5).toLowerCase() as Dir); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); e.stopPropagation(); setEditing(true); requestAnimationFrame(() => input.select()); }
    else if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); navFrom(key, e.shiftKey ? "left" : "right"); }
    else if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") setEditing(true); // type-to-edit: enter edit mode and let the key fall through to the cell
    else { e.preventDefault(); e.stopPropagation(); } // ignore other keys while just selected
  }

  function accountBlock(account: Account) {
    const total = ev.accounts[`${ccCode}:${account.accountCode}`];
    const open = openComments.has(account.id);
    const d = draft(account.id);
    return (
      <tbody key={account.id} className="border-b border-border">
        <tr className="bg-background">
          {gut(grid.accountRow.get(`${ccCode}|${account.id}`))}
          <td className="group relative border-r border-border/60 bg-accent p-0 align-middle">
            {isAdmin && (
              <span
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("accountId", account.id); e.dataTransfer.effectAllowed = "move"; }}
                className="pointer-events-none absolute inset-y-0 left-0 z-10 flex cursor-grab select-none items-center px-1.5 text-white/70 opacity-0 transition-opacity hover:text-white active:cursor-grabbing group-hover:pointer-events-auto group-hover:opacity-100"
                title="Dra till Intäkter eller Kostnader"
              >⠿</span>
            )}
            {renderCell({ id: account.id, field: "accountCode", actual: account.accountCode, className: "text-center font-mono text-sm font-semibold text-white placeholder:text-white/60", url: `/api/budgets/accounts/${account.id}`, payload: (v) => ({ accountCode: v }), gated: true })}
          </td>
          <td className="border-r border-border/60 p-0" colSpan={columns.length - 1}>
            {renderCell({ id: account.id, field: "accountName", actual: account.accountName, className: "font-semibold", placeholder: "Kontonamn", url: `/api/budgets/accounts/${account.id}`, payload: (v) => ({ accountName: v }), gated: true })}
          </td>
          <td className="whitespace-nowrap px-2 text-left text-xs text-muted">
            {canComment && (
              <button
                onClick={() => setOpenComments((s) => { const n = new Set(s); if (n.has(account.id)) n.delete(account.id); else n.add(account.id); return n; })}
                className={cn("px-1 hover:text-foreground", open && "text-accent")} title="Kommentarer"
              >💬{account.comments.length || ""}</button>
            )}
            {isAdmin && <button onClick={() => api(`/api/budgets/accounts/${account.id}`, "DELETE")} className="px-1 hover:text-danger" title="Ta bort konto">×</button>}
          </td>
        </tr>

        {account.lineItems.map((li) => (
          <tr
            key={li.id}
            {...lineDropProps(account, li)}
            className={cn("group border-t transition-colors hover:bg-surface/40", dropLineId === li.id ? "border-t-2 border-t-accent" : "border-border/40")}
          >
            {gut(grid.lineRow.get(`${ccCode}|${li.id}`))}
            {columns.map((col) => lineCell(col, li))}
            <td className="px-2 text-left text-muted">
              {isAdmin && <button onClick={() => api(liUrl(li.id), "DELETE")} className="hover:text-danger" title="Ta bort rad">×</button>}
            </td>
          </tr>
        ))}

        {isAdmin && (
          <tr className="border-t border-border/40 bg-background">
            <td className="w-9 border-r border-border/60" />
            {columns.map((col) => {
              const base = "w-full bg-transparent px-2 py-1.5 outline-none placeholder:text-muted/40 focus:bg-accent-soft/40";
              const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") createLine(account.id); };
              if (col.key === "beskrivning") return <td key={col.key} className="border-r border-border/60 p-0"><input value={d.description} onChange={(e) => setDraft(account.id, { description: e.target.value })} onKeyDown={onEnter} placeholder="+ ny rad" className={cn(base, "pl-5 text-sm text-muted")} /></td>;
              if (col.key === "expression") return <td key={col.key} className="border-r border-border/60 p-0"><input value={d.expression} onChange={(e) => setDraft(account.id, { expression: e.target.value })} onKeyDown={onEnter} onBlur={() => createLine(account.id)} placeholder="belopp" className={cn(base, "text-right font-mono text-xs")} /></td>;
              return <td key={col.key} className="border-r border-border/60" />;
            })}
            <td />
          </tr>
        )}

        {/* Account total, summed below the individual lines (under Belopp). */}
        <tr className="border-t border-border/60 bg-surface/40">
          {gut(undefined)}
          <td colSpan={columns.length - 1} className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted">Summa</td>
          <td className={cn("px-2 py-1.5 text-right font-semibold tabular-nums", total !== undefined && total < 0 && "text-danger")}>{fmt(total)}</td>
          <td />
        </tr>

        {open && (
          <tr className="bg-surface/20">
            <td colSpan={totalCols} className="px-4 py-3">
              <div className="space-y-2">
                {account.comments.length === 0 && <p className="text-xs text-muted">Inga kommentarer.</p>}
                {account.comments.map((cm) => (
                  <div key={cm.id} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0 font-medium">{cm.author.name}</span>
                    <span className="flex-1 text-muted">{cm.body}</span>
                    {(cm.author.id === userId || isAdmin) && (
                      <button onClick={() => api(`/api/budgets/comments/${cm.id}`, "DELETE")} className="shrink-0 text-xs text-muted hover:text-danger">×</button>
                    )}
                  </div>
                ))}
                {canComment && (
                  <input
                    value={commentDraft[account.id] ?? ""}
                    onChange={(e) => setCommentDraft((m) => ({ ...m, [account.id]: e.target.value }))}
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      const body = (commentDraft[account.id] ?? "").trim();
                      if (!body) return;
                      const ok = await api(`/api/budgets/accounts/${account.id}/comments`, "POST", { body });
                      if (ok) setCommentDraft((m) => ({ ...m, [account.id]: "" }));
                    }}
                    placeholder="Skriv en kommentar…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                  />
                )}
              </div>
            </td>
          </tr>
        )}
      </tbody>
    );
  }

  // The "+ nytt konto" row at the foot of a section.
  function addAccountRow(kind: AccountKind) {
    if (!isAdmin) return null;
    const d = acctDraft[kind];
    const set = (patch: Partial<{ code: string; name: string }>) => setAcctDraft((s) => ({ ...s, [kind]: { ...s[kind], ...patch } }));
    return (
      <tbody>
        <tr className="bg-background">
          <td className="w-9 border-r border-border/60" />
          <td className="border-r border-border/60 p-0">
            <input value={d.code} onChange={(e) => set({ code: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") createAccount(kind); }}
              placeholder="+ konto" className="w-full bg-transparent px-2 py-1.5 font-mono text-xs outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
          </td>
          <td className="p-0" colSpan={columns.length}>
            <input value={d.name} onChange={(e) => set({ name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") createAccount(kind); }}
              placeholder={kind === "INCOME" ? "Nytt intäktskonto — Enter" : "Nytt kostnadskonto — Enter"}
              className="w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted/40 focus:bg-accent-soft/40" />
          </td>
        </tr>
      </tbody>
    );
  }

  // One section (Intäkter / Kostnader) as its own rounded card. The whole card
  // is a drop zone — dropping an account row here flips it to this kind.
  function sectionCard(kind: AccountKind, label: string, accts: Account[], total: number) {
    const active = dropKind === kind;
    return (
      <div
        {...dropProps(kind)}
        className={cn(
          "budget-grid overflow-x-auto rounded-2xl border bg-background transition-colors",
          active ? "border-accent ring-1 ring-accent" : "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">
            {label}
            {active && <span className="ml-2 text-xs font-normal text-muted">— släpp för att flytta hit</span>}
          </h3>
          <span className="text-sm tabular-nums text-muted">{fmt(total)}</span>
        </div>
        <table className="w-full border-collapse text-sm table-fixed">
          <colgroup>
            <col style={{ width: GUT_W }} />
            {columns.map((col) => { const w = staticWidth(col); return <col key={col.key} style={w ? { width: w } : undefined} />; })}
            <col style={{ width: ACT_W }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              <th className="select-none border-r border-border/60 px-1 py-2 text-center font-mono text-[10px] text-muted/50">#</th>
              {columns.map((col) => (
                <Hc key={col.key} letter={col.letter} align={col.kind === "number" ? "right" : undefined}>{col.name}</Hc>
              ))}
              <th className="border-l border-border/60" />
            </tr>
          </thead>
          {accts.map(accountBlock)}
          {addAccountRow(kind)}
        </table>
      </div>
    );
  }

  return (
    <div
      ref={sheetRef}
      className={cn("space-y-4", editing && "is-editing")}
      onKeyDownCapture={onSheetKeyDown}
      onFocusCapture={() => setEditing(false)}
      onDoubleClick={(e) => { if ((e.target as HTMLElement).dataset?.cell) setEditing(true); }}
    >
      {/* summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Summa intäkter", v: totals.income },
          { label: "Summa utgifter", v: totals.cost },
          { label: "Resultat", v: totals.result, signed: true },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-background px-4 py-3">
            <p className="text-xs text-muted">{s.label}</p>
            <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", s.signed && (s.v < 0 ? "text-danger" : s.v > 0 ? "text-success" : ""))}>
              {s.signed ? fmtSigned(s.v) : fmt(s.v)}
            </p>
          </div>
        ))}
      </div>

      {sectionCard("INCOME", "Intäkter", income, totals.income)}
      {sectionCard("COST", "Kostnader", cost, totals.cost)}
    </div>
  );
}

// Column header with its A1 letter shown before the name (the six general
// columns are unnamed, so they show just their letter).
function Hc({ letter, align, title, children }: {
  letter: string; align?: "right"; title?: string; children: React.ReactNode;
}) {
  return (
    <th title={title} className={cn("border-r border-border/60 px-2 py-2", align === "right" ? "text-right" : "text-left")}>
      <span className="mr-1 font-mono text-[10px] font-normal text-muted/40">{letter}</span>{children}
    </th>
  );
}
