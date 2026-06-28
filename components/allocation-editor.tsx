"use client";

import { cn } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";
import type { CostCenter } from "@/lib/types";

export interface AllocationRow {
  id: string;
  costCenterCode: string;
  amount: string;
  comment: string;
}

const _uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export function makeRow(code: string, amount = "", comment = ""): AllocationRow {
  return { id: _uid(), costCenterCode: code, amount, comment };
}

export const numAlloc = (s: string) => Number(s.replace(",", ".")) || 0;

interface Props {
  costCenters: CostCenter[];
  grossAmount: number; // SEK — used only for the balance indicator
  value: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
}

export function AllocationEditor({ costCenters, grossAmount, value, onChange }: Props) {
  const total = value.reduce((s, r) => s + numAlloc(r.amount), 0);
  const balanced = grossAmount > 0 && Math.abs(total - grossAmount) < 0.005;

  function update(id: string, patch: Partial<AllocationRow>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function remove(id: string) {
    if (value.length <= 1) return;
    onChange(value.filter((r) => r.id !== id));
  }

  function add() {
    const used = new Set(value.map((r) => r.costCenterCode));
    const next = costCenters.find((c) => !used.has(c.code));
    onChange([...value, makeRow(next?.code ?? costCenters[0]?.code ?? "")]);
  }

  const ccOptions = costCenters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }));
  const amt = cn(
    "w-28 rounded-lg border border-border bg-background px-2.5 py-1.5 text-right text-sm tabular-nums",
    "focus:border-accent focus:outline-none",
  );

  const comment = cn(
    "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm italic text-muted",
    "placeholder:text-muted/50 focus:border-accent focus:not-italic focus:text-foreground focus:outline-none",
  );

  return (
    <div className="space-y-3">
      {value.map((row) => (
        <div key={row.id} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Combobox
              className="flex-1"
              options={ccOptions}
              value={row.costCenterCode}
              onChange={(v) => update(row.id, { costCenterCode: v })}
              placeholder="Välj kostnadsställe…"
              searchPlaceholder="Sök kostnadsställe…"
              aria-label="Kostnadsställe"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Belopp"
              value={row.amount}
              onChange={(e) => update(row.id, { amount: e.target.value })}
              className={amt}
            />
            <span className="text-xs text-muted">kr</span>
            <button
              type="button"
              disabled={value.length <= 1}
              onClick={() => remove(row.id)}
              aria-label="Ta bort rad"
              className="flex size-7 items-center justify-center rounded-full text-lg leading-none text-muted transition-colors hover:bg-surface hover:text-danger disabled:opacity-30"
            >
              ×
            </button>
          </div>
          <input
            type="text"
            placeholder="Kommentar (valfri)…"
            value={row.comment}
            onChange={(e) => update(row.id, { comment: e.target.value })}
            className={comment}
          />
        </div>
      ))}

      <div className="flex items-center justify-between pt-0.5">
        <button
          type="button"
          onClick={add}
          disabled={value.length >= costCenters.length}
          className="text-sm font-medium text-accent hover:underline disabled:opacity-40"
        >
          + Lägg till kostnadsställe
        </button>
        {grossAmount > 0 && (
          <p className={cn("text-xs tabular-nums", balanced ? "text-success" : "text-warning")}>
            {total.toFixed(2)} / {grossAmount.toFixed(2)} kr
          </p>
        )}
      </div>
    </div>
  );
}
