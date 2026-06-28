"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCheck, IconPlus } from "@/components/ui/icons";
import { useRole } from "@/components/role-context";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { PageShell } from "@/components/page-shell";
import { Combobox } from "@/components/ui/combobox";
import { ACCOUNT, ACCOUNTS, accountName } from "@/lib/accounts";
import { formatSEK } from "@/lib/format";
import { DateInput } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { CostCenter, Expense } from "@/lib/types";

interface Row {
  id: string;
  account: string;
  description: string;
  costCenterCode: string;
  debit: string;
  credit: string;
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const accountExists = (n: string) => ACCOUNTS.some((a) => a.number === n.trim());

// Suggest a balanced default voucher from the expense: the full cost on the
// debit side, payment account (bank or member debt) on the credit side. VAT is
// no longer stored on the expense — split it out manually here if needed.
function defaultRows(expense: Expense | undefined): Row[] {
  if (!expense) return [];
  const gross = expense.grossAmount;
  const debitRows: Row[] =
    expense.allocations.length > 0
      ? expense.allocations.map((a) => ({
          id: uid(),
          account: "",
          description: "",
          costCenterCode: a.costCenterCode,
          debit: a.amount.toFixed(2),
          credit: "",
        }))
      : [
          {
            id: uid(),
            account: "",
            description: "",
            costCenterCode: "",
            debit: gross ? gross.toFixed(2) : "",
            credit: "",
          },
        ];
  return [
    {
      id: uid(),
      account: expense.paymentType === "CARD" ? ACCOUNT.BANK : ACCOUNT.MEMBER_DEBT,
      description: "",
      costCenterCode: "",
      debit: "",
      credit: gross ? gross.toFixed(2) : "",
    },
    ...debitRows
  ];
}

// Existing voucher → editable rows (when amending a booked verification).
function rowsFromVerification(expense: Expense): Row[] {
  return (expense.verification?.lines ?? []).map((l) => ({
    id: l.id,
    account: l.account,
    description: l.description ?? "",
    costCenterCode: l.costCenterCode ?? "",
    debit: l.debit ? l.debit.toFixed(2) : "",
    credit: l.credit ? l.credit.toFixed(2) : "",
  }));
}

export default function BookExpenseClient({
  expense,
  costCenters,
}: {
  expense: Expense | null;
  costCenters: CostCenter[];
}) {
  const router = useRouter();
  const { role } = useRole();

  // APPROVED → create a voucher; BOOKED → amend it (before export).
  const mode: "create" | "edit" | null =
    expense?.status === "APPROVED" ? "create" : expense?.status === "BOOKED" ? "edit" : null;

  // The verifikationstext always starts with a fixed, non-editable prefix: the
  // submitter's name for a card purchase, "PU <name>" for a reimbursement. The
  // user can only append free text after it.
  const textPrefix = expense
    ? expense.paymentType === "CARD" ? expense.submitterName : `PU ${expense.submitterName}`
    : "";

  const [date, setDate] = useState(
    () => expense?.verification?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [textSuffix, setTextSuffix] = useState(() => {
    const full = expense?.verification?.description ?? expense?.title ?? "";
    return full.startsWith(textPrefix) ? full.slice(textPrefix.length).trim() : full;
  });
  const verifikationstext = textSuffix.trim() ? `${textPrefix} ${textSuffix.trim()}` : textPrefix;
  const [rows, setRows] = useState<Row[]>(() =>
    expense?.status === "BOOKED"
      ? rowsFromVerification(expense)
      : defaultRows(expense ?? undefined),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!expense) {
    return (
      <EmptyState
        title="Utlägget hittades inte"
        description="Det kan ha tagits bort eller så är länken fel."
        action={<ButtonLink href="/expenses">Till alla utlägg</ButtonLink>}
      />
    );
  }

  const mayBook = role === "BOOKKEEPER" || role === "ADMIN";
  if (!mayBook) {
    return (
      <EmptyState
        title="Behörighet saknas"
        description="Endast kassör eller administratör kan bokföra utlägg."
        action={<ButtonLink href={`/expenses/${expense.id}`}>Tillbaka</ButtonLink>}
      />
    );
  }
  if (!mode) {
    return (
      <EmptyState
        title={expense.status === "EXPORTED" ? "Kan inte ändras" : "Kan inte bokföras"}
        description={
          expense.status === "EXPORTED"
            ? "Verifikationen är exporterad till Fortnox och kan inte längre ändras."
            : "Bara attesterade utlägg kan bokföras."
        }
        action={<ButtonLink href={`/expenses/${expense.id}`}>Till utlägget</ButtonLink>}
      />
    );
  }

  const num = (s: string) => Number(s.replace(",", ".")) || 0;
  const totalDebit = rows.reduce((s, r) => s + num(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + num(r.credit), 0);
  const diff = round2(totalDebit - totalCredit);
  const balanced = diff === 0 && totalDebit > 0;
  const costCenterExists = (code: string) => costCenters.some((c) => c.code === code.trim());
  const allValidAccounts = rows.every((r) => accountExists(r.account));
  const allValidCostCenters = rows.every(
    (r) => !r.costCenterCode.trim() || costCenterExists(r.costCenterCode),
  );
  const canSubmit = balanced && allValidAccounts && allValidCostCenters && !submitting;

  function patch(id: string, change: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      { id: uid(), account: "", description: "", costCenterCode: "", debit: "", credit: "" },
    ]);
  }
  function removeRow(id: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  async function save() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        date,
        description: verifikationstext,
        lines: rows.map((r) => ({
          account: r.account.trim(),
          accountName: accountName(r.account),
          description: r.description || null,
          costCenterCode: r.costCenterCode || null,
          debit: Math.round(num(r.debit) * 100),
          credit: Math.round(num(r.credit) * 100),
        })),
      };
      const res = await fetch(`/api/expenses/${expense!.id}/book`, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "" }));
        throw new Error(msg || `Det gick inte att spara (${res.status})`);
      }
      router.push(`/expenses/${expense!.id}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Något gick fel");
    }
  }

  const fieldInput =
    "h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm focus-inset";
  const headerCell = "px-3 py-2.5 text-center font-medium";
  const cellInput =
    "block h-10 w-full bg-transparent px-3 text-center text-sm placeholder:text-muted/50 focus-inset";
  const amountInput = cn(cellInput, "tabular-nums");
  const cellCombo = "h-10 bg-transparent px-3 focus-inset";
  const accountOptions = ACCOUNTS.map((a) => ({ value: a.number, label: `${a.number} · ${a.name}` }));
  const ccOptions = costCenters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }));

  return (
    <PageShell
      title={mode === "edit" ? `Ändra verifikation · ${expense.id}` : `Bokför ${expense.id}`}
      description={
        mode === "edit"
          ? "Justera konteringsraderna innan utlägget exporteras till Fortnox."
          : "Skapa verifikation – kontera och balansera debet mot kredit."
      }
      action={<ButtonLink href={`/expenses/${expense.id}`}>Avbryt</ButtonLink>}
      width={expense.receiptId ? "wide" : "content"}
    >

      <div
        className={cn(
          expense.receiptId && "grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]",
        )}
      >
        {expense.receiptId && (
          <div className="lg:sticky lg:top-6 lg:self-start">
            <ReceiptViewer
              receiptId={expense.receiptId}
              mimeType={expense.receiptMimeType ?? "image/jpeg"}
              filename={`Kvitto · ${expense.merchant}`}
              className="h-[40vh] rounded-xl border border-border"
            />
          </div>
        )}

        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="grid gap-5 sm:grid-cols-[180px_1fr]">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">Verifikationsdatum</label>
            <DateInput
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldInput}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium">Verifikationstext</label>
            <div className="flex h-9 w-full items-center rounded-lg border border-border bg-background px-2.5 text-sm focus-within:border-accent">
              <span className="shrink-0 whitespace-nowrap font-medium text-muted" title="Fast prefix – kan inte ändras">
                {textPrefix}
              </span>
              <input
                value={textSuffix}
                onChange={(e) => setTextSuffix(e.target.value)}
                placeholder="lägg till text…"
                aria-label="Verifikationstext (efter prefix)"
                style={{ outline: "none" }}
                className="ml-1.5 min-w-0 flex-1 bg-transparent placeholder:text-muted/50"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Konteringsrader" subtitle="Debet och kredit måste vara lika stora." />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="divide-x divide-border border-b border-border bg-surface/40 text-xs text-muted">
                <th className={cn(headerCell, "w-1/10")}>Konto</th>
                <th className={cn(headerCell, "w-1/5")}>Kostnadsställe</th>
                <th className={cn(headerCell, "w-1/5")}>Beskrivning</th>
                <th className={cn(headerCell, "w-1/8")}>Debet</th>
                <th className={cn(headerCell, "w-1/8")}>Kredit</th>
                <th className="w-1/15" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                return (
                  <tr key={r.id} className="divide-x divide-border">
                    <td className="p-0 align-middle">
                      <Combobox
                        options={accountOptions}
                        value={r.account}
                        onChange={(v) => patch(r.id, { account: v })}
                        placeholder="Konto…"
                        searchPlaceholder="Sök konto…"
                        buttonClassName={cellCombo}
                        aria-label="Konto"
                      />
                    </td>
                    <td className="p-0 align-middle">
                      <Combobox
                        options={ccOptions}
                        value={r.costCenterCode}
                        onChange={(v) => patch(r.id, { costCenterCode: v })}
                        placeholder="—"
                        searchPlaceholder="Sök kostnadsställe…"
                        allowClear
                        buttonClassName={cellCombo}
                        aria-label="Kostnadsställe"
                      />
                    </td>
                    <td className="p-0 align-middle">
                      <input
                        value={r.description}
                        onChange={(e) => patch(r.id, { description: e.target.value })}
                        placeholder="Text"
                        className={cellInput}
                      />
                    </td>
                    <td className="p-0 align-middle">
                      <input
                        inputMode="decimal"
                        value={r.debit}
                        onChange={(e) => patch(r.id, { debit: e.target.value })}
                        className={amountInput}
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-0 align-middle">
                      <input
                        inputMode="decimal"
                        value={r.credit}
                        onChange={(e) => patch(r.id, { credit: e.target.value })}
                        className={amountInput}
                        placeholder="0,00"
                      />
                    </td>
                    <td className="text-center align-middle">
                      <button
                        onClick={() => removeRow(r.id)}
                        className="px-2 text-muted transition-colors hover:text-danger"
                        aria-label="Ta bort rad"
                        title="Ta bort rad"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td colSpan={3} className="px-3 py-3">
                  <button
                    onClick={addRow}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                  >
                    <IconPlus className="size-4" />
                    Lägg till rad
                  </button>
                </td>
                <td className="px-3 py-3 text-center tabular-nums">{formatSEK(totalDebit)}</td>
                <td className="px-3 py-3 text-center tabular-nums">{formatSEK(totalCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
          {balanced ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-sm font-medium text-success">
              <IconCheck className="size-4" />
              Balanserar
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger">
              Differens {formatSEK(diff)}
            </span>
          )}

          <div className="flex items-center gap-2.5">
            <ButtonLink href={`/expenses/${expense.id}`} variant="secondary">
              Avbryt
            </ButtonLink>
            <Button onClick={save} disabled={!canSubmit}>
              <IconCheck className="size-4" />
              {mode === "edit"
                ? submitting
                  ? "Sparar…"
                  : "Spara ändringar"
                : submitting
                  ? "Bokför…"
                  : "Bokför"}
            </Button>
          </div>
        </CardBody>
        {error && <p className="px-6 pb-5 text-sm text-danger">{error}</p>}
      </Card>
        </div>
      </div>

      {/* Shared suggestions for the typeable Konto / Kostnadsställe inputs. */}
    </PageShell>
  );
}
