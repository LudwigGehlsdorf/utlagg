"use client";

import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, DateInput } from "@/components/ui/field";
import { AllocationEditor, makeRow, numAlloc } from "@/components/allocation-editor";
import type { AllocationRow } from "@/components/allocation-editor";
import { EmptyState } from "@/components/ui/empty-state";
import { IconReceipt, IconUpload } from "@/components/ui/icons";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { useNotify } from "@/components/notifications";
import { PageShell } from "@/components/page-shell";
import { PAYMENT_META, isEditable } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { CostCenter, Expense, PaymentType } from "@/lib/types";

const num = (s: string) => Number(s.replace(",", ".")) || 0;

export default function EditExpenseClient({
  expenses,
  costCenters,
}: {
  expenses: Expense[];
  costCenters: CostCenter[];
}) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const notify = useNotify();
  const expense = expenses.find((e) => e.id === params.id);
  // Active cost centres, plus any this expense already uses (so an existing
  // allocation on a now-inactive cost centre stays selectable while editing).
  const usedCodes = new Set(expense?.allocations.map((a) => a.costCenterCode) ?? []);
  const availableCostCenters = costCenters.filter((c) => c.active || usedCodes.has(c.code));

  const [form, setForm] = useState(() => ({
    title: expense?.title ?? "",
    merchant: expense?.merchant ?? "",
    purchaseDate: expense?.purchaseDate ?? "",
    gross: expense ? String(expense.grossAmount) : "",
  }));
  const [allocations, setAllocations] = useState<AllocationRow[]>(() =>
    expense?.allocations.length
      ? expense.allocations.map((a) => makeRow(a.costCenterCode, String(a.amount), a.comment ?? ""))
      : [makeRow(availableCostCenters[0]?.code ?? "")],
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    expense?.paymentType ?? "CARD",
  );
  const [saving, setSaving] = useState(false);
  const [receiptId, setReceiptId] = useState(expense?.receiptId);
  const [receiptMime, setReceiptMime] = useState(expense?.receiptMimeType ?? "image/jpeg");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!expense) {
    return (
      <EmptyState
        title="Utlägget hittades inte"
        description="Det kan ha tagits bort eller så är länken fel."
        action={<ButtonLink href="/expenses">Till alla utlägg</ButtonLink>}
      />
    );
  }
  if (!isEditable(expense.status)) {
    return (
      <EmptyState
        title="Kan inte redigeras"
        description="Utlägget är redan signerat och kan inte längre ändras."
        action={<ButtonLink href={`/expenses/${expense.id}`}>Till utlägget</ButtonLink>}
      />
    );
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submittable = ["DRAFT", "PENDING_MATCH", "CHANGES_REQUESTED"].includes(
    expense.status,
  );

  async function uploadReceipt(file: File) {
    setUploading(true);
    try {
      // Delete the current receipt before uploading a new one.
      if (receiptId) {
        await fetch(`/api/receipts/${receiptId}`, { method: "DELETE" });
        setReceiptId(undefined);
      }
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/expenses/${expense!.id}/receipts`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "" }));
        throw new Error(msg || `Uppladdningen misslyckades (${res.status})`);
      }
      const data = await res.json();
      setReceiptId(data.id);
      setReceiptMime(data.mimeType ?? "image/jpeg");
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Uppladdningen misslyckades");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(submitAfter = false) {
    setSaving(true);
    try {
      const res = await fetch(`/api/expenses/${expense!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          merchant: form.merchant,
          purchaseDate: form.purchaseDate || null,
          grossAmount: Math.round(num(form.gross) * 100),
          allocations: allocations.map((a) => ({
            costCenterCode: a.costCenterCode,
            amount: numAlloc(a.amount),
            comment: a.comment || undefined,
          })),
          paymentType,
        }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "" }));
        throw new Error(msg || `Kunde inte spara (${res.status})`);
      }
      if (submitAfter) {
        const r2 = await fetch(`/api/expenses/${expense!.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "submit" }),
        });
        if (!r2.ok) {
          const { error: msg } = await r2.json().catch(() => ({ error: "" }));
          throw new Error(msg || "Sparat, men kunde inte skickas in");
        }
      }
      notify.success(submitAfter ? "Sparat och inskickat." : "Ändringarna sparades.");
      router.push(`/expenses/${expense!.id}`);
      router.refresh();
    } catch (err) {
      setSaving(false);
      notify.error(err instanceof Error ? err.message : "Något gick fel");
    }
  }

  return (
    <PageShell
      title={`Redigera ${expense.id}`}
      description="Ändra uppgifterna och spara. Ändringen loggas i historiken."
      action={<ButtonLink href={`/expenses/${expense.id}`}>Avbryt</ButtonLink>}
      width="form"
    >
      <Card>
        <CardBody className="space-y-5">
          <Field label="Beskrivning">
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Butik">
              <Input value={form.merchant} onChange={(e) => set({ merchant: e.target.value })} />
            </Field>
            <Field label="Inköpsdatum">
              <DateInput
                value={form.purchaseDate}
                onChange={(e) => set({ purchaseDate: e.target.value })}
              />
            </Field>
            <Field label="Belopp">
              <Input
                inputMode="decimal"
                value={form.gross}
                onChange={(e) => {
                  set({ gross: e.target.value });
                  if (allocations.length === 1) {
                    setAllocations([{ ...allocations[0], amount: e.target.value }]);
                  }
                }}
              />
            </Field>
          </div>

          <Field label="Kostnadsfördelning">
            <AllocationEditor
              costCenters={availableCostCenters}
              grossAmount={num(form.gross)}
              value={allocations}
              onChange={setAllocations}
            />
          </Field>

          {/* Receipt upload / replace */}
          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Kvitto</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadReceipt(f);
              }}
            />
            {receiptId ? (
              <div className="space-y-2">
                <ReceiptViewer
                  receiptId={receiptId}
                  mimeType={receiptMime}
                  filename="Kvitto"
                  className="h-56 rounded-xl border border-border"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <IconUpload className="size-4" />
                  {uploading ? "Laddar upp…" : "Byt kvitto"}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface/50 py-8 text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-50"
              >
                <IconReceipt className="size-7" />
                <span className="text-sm font-medium">
                  {uploading ? "Laddar upp…" : "Lägg till kvitto"}
                </span>
              </button>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Betalsätt</span>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(PAYMENT_META) as PaymentType[]).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setPaymentType(pt)}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left transition-colors",
                    paymentType === pt
                      ? "border-accent bg-accent-soft"
                      : "border-border hover:bg-surface",
                  )}
                >
                  <span className="block text-sm font-medium">{PAYMENT_META[pt].label}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {PAYMENT_META[pt].description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2.5 pt-1">
            <ButtonLink href={`/expenses/${expense.id}`} variant="secondary">
              Avbryt
            </ButtonLink>
            <Button
              variant={submittable ? "secondary" : "primary"}
              onClick={() => save(false)}
              disabled={saving || !form.title.trim()}
            >
              {saving ? "Sparar…" : "Spara ändringar"}
            </Button>
            {submittable && (
              <Button onClick={() => save(true)} disabled={saving || !form.title.trim()}>
                {expense.status === "CHANGES_REQUESTED"
                  ? "Spara och skicka in igen"
                  : "Spara och skicka in"}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}
