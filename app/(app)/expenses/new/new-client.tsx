"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { useNotify } from "@/components/notifications";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, DateInput } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
import {
  IconCheck,
  IconLink,
  IconSparkle,
  IconUpload,
} from "@/components/ui/icons";
import { PAYMENT_META } from "@/lib/status";
import { formatDate, formatSEK } from "@/lib/format";
import type { BankTransaction, CostCenter, PaymentType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AllocationEditor, makeRow, numAlloc } from "@/components/allocation-editor";
import type { AllocationRow } from "@/components/allocation-editor";

const STEPS = ["Ladda upp", "Granska", "Matcha", "Skicka in"];

const num = (s: string) => Number(s.replace(",", ".")) || 0;

export default function NewExpenseClient({
  costCenters,
  bankTransactions,
}: {
  costCenters: CostCenter[];
  bankTransactions: BankTransaction[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notify = useNotify();
  // Only active (Fortnox-synced) cost centres are selectable for new expenses.
  const activeCostCenters = costCenters.filter((c) => c.active);
  // "Redovisa" deep-link from the Kortköp page: ?txn=<bankTxnId> pre-matches the
  // card purchase and prefills amount/merchant/date from the bank row.
  const presetTxn = (() => {
    const id = searchParams.get("txn");
    return id ? bankTransactions.find((t) => t.id === id) : undefined;
  })();
  const [step, setStep] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>("CARD");
  const [form, setForm] = useState(() =>
    presetTxn
      ? {
          title: presetTxn.description,
          merchant: presetTxn.description,
          purchaseDate: presetTxn.bookedDate,
          gross: String(Math.abs(presetTxn.amount)),
        }
      : {
          title: "",
          merchant: "",
          purchaseDate: "",
          gross: "",
        },
  );
  const [allocations, setAllocations] = useState<AllocationRow[]>(() => [
    makeRow(
      activeCostCenters[0]?.code ?? "",
      presetTxn ? String(Math.abs(presetTxn.amount)) : "",
    ),
  ]);
  const [matchId, setMatchId] = useState<string | null>(presetTxn ? presetTxn.id : null);
  const [clearing, setClearing] = useState("");
  const [account, setAccount] = useState("");
  const [saving, setSaving] = useState(false);

  // Real receipt upload (browser → Next route → MinIO).
  const fileInput = useRef<HTMLInputElement>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [uploadedMime, setUploadedMime] = useState<string>("");
  const [uploadedName, setUploadedName] = useState<string>("");

  // Create a DRAFT expense once, then reuse it for further uploads.
  async function ensureDraft(): Promise<{ id: string; reference: string }> {
    if (draftId && reference) return { id: draftId, reference };
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentType,
        matchedTransactionId: presetTxn?.id ?? null,
      }),
    });
    if (!res.ok) throw new Error("Kunde inte skapa utlägg");
    const data = await res.json();
    setDraftId(data.id);
    setReference(data.reference);
    return data;
  }

  async function handleFile(file: File) {
    // First upload pre-fills the form and advances; a later "Byt kvitto" just
    // swaps the stored receipt without clobbering edits you've already made.
    const isFirst = !receiptId;
    setScanning(true);
    try {
      const draft = await ensureDraft();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/expenses/${draft.id}/receipts`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || `Uppladdning misslyckades (${res.status})`);
      }
      const receipt = await res.json();
      setReceiptId(receipt.id);
      setUploadedMime(receipt.mimeType ?? file.type);
      setUploadedName(receipt.filename ?? file.name);
      // OCR isn't built yet — keep the mock pre-fill, but the file is now
      // really stored in MinIO. (Brief delay preserves the "scanning" feel.)
      setTimeout(() => {
        if (isFirst) {

          setStep(1);
        }
        setScanning(false);
      }, 900);
    } catch (err) {
      setScanning(false);
      notify.error(err instanceof Error ? err.message : "Något gick fel");
    }
  }

  const candidates = useMemo(() => {
    const gross = num(form.gross);
    return bankTransactions.filter((t) => !t.matchedExpenseId && t.amount < 0)
      .map((t) => ({ t, diff: Math.abs(Math.abs(t.amount) - gross) }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 4);
  }, [form.gross, bankTransactions]);

  const matchDone = paymentType === "CARD" ? matchId !== null : clearing !== "" && account !== "";
  const filledForm = form.gross && form.merchant && form.purchaseDate && allocations.length > 0;

  const grossSEK = num(form.gross);
  const canPersist = form.title.trim() !== "" && !saving;

  // Save the reviewed fields onto the draft expense (created at upload).
  async function persist(): Promise<boolean> {
    if (!reference) return false;
    const res = await fetch(`/api/expenses/${reference}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        merchant: form.merchant,
        purchaseDate: form.purchaseDate || null,
        grossAmount: Math.round(grossSEK * 100),
        allocations: allocations.map((a) => ({
          costCenterCode: a.costCenterCode,
          amount: numAlloc(a.amount),
          comment: a.comment || undefined,
        })),
        paymentType,
      }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "" }));
      throw new Error(error || `Kunde inte spara (${res.status})`);
    }
    return true;
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await persist();
      notify.success("Utkast sparat.");
      router.push(`/expenses/${reference}`);
      router.refresh();
    } catch (err) {
      setSaving(false);
      notify.error(err instanceof Error ? err.message : "Något gick fel");
    }
  }

  async function submitExpense() {
    setSaving(true);
    try {
      await persist();
      const res = await fetch(`/api/expenses/${reference}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || "Sparat, men kunde inte skickas in");
      }
      notify.success("Utlägget skickades in för attest.");
      router.push(`/expenses/${reference}`);
      router.refresh();
    } catch (err) {
      setSaving(false);
      notify.error(err instanceof Error ? err.message : "Något gick fel");
    }
  }

  return (
    <PageShell
      title="Nytt utlägg"
      description="Ladda upp ett kvitto så fyller vi i resten."
      width={step === 0 ? "form" : "content"}
    >
      <Stepper steps={STEPS} current={step} />

      {/* Hidden file input — used by the dropzone and "Byt kvitto" alike. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

      {/* Step 1 — upload (shows the current receipt when you step back here) */}
      {step === 0 && (
        <Card>
          <CardBody>
            {receiptId && !scanning ? (
              <div className="space-y-4">
                <ReceiptPanel
                  receiptId={receiptId}
                  mime={uploadedMime}
                  filename={uploadedName}
                  reference={reference}
                />
                <div className="flex justify-between">
                  <Button
                    variant="secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    <IconUpload className="size-4" />
                    Byt kvitto
                  </Button>
                  <Button onClick={() => setStep(1)}>Fortsätt</Button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f && !scanning) handleFile(f);
                }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface/50 px-6 py-14 text-center transition-colors",
                  scanning && "border-accent bg-accent-soft/40",
                )}
              >
                {scanning ? (
                  <>
                    <span className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-accent text-white">
                      <IconSparkle className="size-6" />
                    </span>
                    <p className="mt-4 text-sm font-medium">Laddar upp kvitto…</p>
                    <p className="mt-1 text-xs text-muted">
                      Sparar bilden och läser av butik, datum och belopp.
                    </p>
                  </>
                ) : (
                  <>
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                      <IconUpload className="size-6" />
                    </span>
                    <p className="mt-4 text-sm font-medium">
                      Dra hit ditt kvitto eller välj en fil
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      PDF, JPG eller PNG · vi fyller i formuläret åt dig
                    </p>
                    <Button
                      className="mt-5"
                      onClick={() => fileInput.current?.click()}
                    >
                      <IconUpload className="size-4" />
                      Välj kvitto
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Steps 2–4 — receipt pinned beside the data entry */}
      {step > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Left: the uploaded receipt, fetched back through the server */}
          <div className="rg:sticky rg:top-6 lg:self-start">
            <ReceiptPanel
              receiptId={receiptId}
              mime={uploadedMime}
              filename={uploadedName}
              reference={reference}
            />
          </div>

          {/* Right: the current step's form */}
          <div>
      {/* Step 2 — review proposed form */}
      {step === 1 && (
        <Card>
          <CardBody className="space-y-5">
            <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm text-accent">
              <IconSparkle className="size-4 shrink-0" />
              Förifyllt från kvittot – kontrollera mot kvittot och justera vid behov.
            </div>

            <Field label="Beskrivning">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Butik">
                <Input
                  value={form.merchant}
                  onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                />
              </Field>
              <Field label="Inköpsdatum">
                <DateInput
                  value={form.purchaseDate}
                  onChange={(e) =>
                    setForm({ ...form, purchaseDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Belopp">
                <Input
                  value={form.gross}
                  onChange={(e) => {
                    setForm({ ...form, gross: e.target.value });
                    if (allocations.length === 1) {
                      setAllocations([{ ...allocations[0], amount: e.target.value }]);
                    }
                  }}
                  type="number"
                />
              </Field>
            </div>

            <Field label="Kostnadsfördelning">
              <AllocationEditor
                costCenters={activeCostCenters}
                grossAmount={grossSEK}
                value={allocations}
                onChange={setAllocations}
              />
            </Field>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium">
                Betalsätt
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(PAYMENT_META) as PaymentType[]).map((pt) => (
                  <button
                    key={pt}
                    onClick={() => setPaymentType(pt)}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      paymentType === pt
                        ? "border-accent bg-accent-soft"
                        : "border-border hover:bg-surface",
                    )}
                  >
                    <span className="block text-sm font-medium">
                      {PAYMENT_META[pt].label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {PAYMENT_META[pt].description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-2.5 pt-1">
              <Button variant="secondary" onClick={() => setStep(0)}>
                Tillbaka
              </Button>
              <div className="flex gap-2.5">
                <Button variant="secondary" onClick={saveDraft} disabled={!canPersist}>
                  {saving ? "Sparar…" : "Spara utkast"}
                </Button>
                <Button disabled={!filledForm} onClick={() => setStep(2)}>Fortsätt</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 3 — match (branches on payment type) */}
      {step === 2 && (
        <Card>
          <CardBody className="space-y-5">
            {paymentType === "CARD" ? (
              <>
                <div>
                  <h2 className="text-base font-semibold">
                    Matcha mot banktransaktion
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Välj transaktionen från sektionskortet som hör till köpet.
                    Belopp och datum låses till banken.
                  </p>
                </div>
                <ul className="space-y-2.5">
                  {candidates.map(({ t, diff }, i) => {
                    const selected = matchId === t.id;
                    const suggested = i === 0 && diff === 0;
                    return (
                      <li key={t.id}>
                        <button
                          onClick={() => setMatchId(t.id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                            selected
                              ? "border-accent bg-accent-soft"
                              : "border-border hover:bg-surface",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-9 items-center justify-center rounded-full",
                              selected
                                ? "bg-accent text-white"
                                : "bg-surface text-muted",
                            )}
                          >
                            <IconLink className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">
                                {t.description}
                              </p>
                              {suggested && (
                                <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                                  Föreslagen
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted">
                              {formatDate(t.bookedDate)}
                            </p>
                          </div>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatSEK(t.amount)}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-base font-semibold">
                    Dina kontouppgifter
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Eftersom du lagt ut egna pengar matchas utbetalningen mot
                    banken först när kassören betalar ut – efter attest.
                  </p>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Clearingnummer">
                    <Input
                      value={clearing}
                      placeholder="t.ex. 8327-9"
                      onChange={(e) => setClearing(e.target.value)}
                    />
                  </Field>
                  <Field label="Kontonummer">
                    <Input
                      value={account}
                      placeholder="t.ex. 123 456 789-0"
                      onChange={(e) => setAccount(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="rounded-xl bg-surface px-3.5 py-2.5 text-xs text-muted">
                  Matchning mot banktransaktion sker automatiskt vid utbetalning.
                </div>
              </>
            )}
            <div className="flex flex-wrap justify-between gap-2.5 pt-1">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Tillbaka
              </Button>
              <div className="flex gap-2.5">
                <Button variant="secondary" onClick={saveDraft} disabled={!canPersist}>
                  {saving ? "Sparar…" : "Spara utkast"}
                </Button>
                <Button disabled={!matchDone} onClick={() => setStep(3)}>
                  Fortsätt
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 4 — review & submit / success */}
      {step === 3 && (
        <Card>
          <CardBody className="space-y-5">
            <h2 className="text-base font-semibold">Granska och skicka in</h2>
            <dl className="divide-y divide-border rounded-xl border border-border">
              <Row label="Beskrivning" value={form.title} />
              <Row label="Butik" value={form.merchant} />
              <Row label="Datum" value={formatDate(form.purchaseDate)} />
              <Row label="Belopp" value={formatSEK(grossSEK)} />
              {allocations.map((a, i) => (
                <Row
                  key={a.id}
                  label={i === 0 ? "Kostnadsfördelning" : ""}
                  value={`${a.costCenterCode} · ${formatSEK(numAlloc(a.amount))}`}
                />
              ))}
              <Row label="Betalsätt" value={PAYMENT_META[paymentType].label} />
              <Row
                label="Matchning"
                value={
                  paymentType === "CARD"
                    ? bankTransactions.find((t) => t.id === matchId)
                        ?.description ?? "—"
                    : "Vid utbetalning"
                }
              />
            </dl>

            <div className="flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-sm text-muted">
              <IconCheck className="size-4 shrink-0 text-success" />
              Skickas till{" "}
              {[...new Set(
                allocations
                  .map((a) => costCenters.find((c) => c.code === a.costCenterCode)?.approverName)
                  .filter(Boolean),
              )].join(", ")}{" "}
              för attest.
            </div>
            <div className="flex flex-wrap justify-between gap-2.5 pt-1">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Tillbaka
              </Button>
              <div className="flex gap-2.5">
                <Button variant="secondary" onClick={saveDraft} disabled={!canPersist}>
                  {saving ? "Sparar…" : "Spara utkast"}
                </Button>
                <Button onClick={submitExpense} disabled={!canPersist}>
                  {saving ? "Skickar…" : "Skicka in för attest"}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/expenses" className="hover:text-foreground">
          Avbryt
        </Link>
      </p>
    </PageShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

// Shows the uploaded receipt next to the form. Streamed back through the
// server from MinIO (GET /api/receipts/:id), so MinIO stays internal.
function ReceiptPanel({
  receiptId,
  mime,
  filename,
  reference,
}: {
  receiptId: string | null;
  mime: string;
  filename: string;
  reference: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <IconCheck className="size-4 shrink-0 text-success" />
          <span className="truncate">{filename || "Kvitto"}</span>
        </p>
        {reference && (
          <span className="shrink-0 text-xs text-muted">{reference}</span>
        )}
      </div>
      {receiptId ? (
        <ReceiptViewer
          receiptId={receiptId}
          mimeType={mime}
          filename={filename}
          className="h-[51vh]"
        />
      ) : (
        <div className="flex h-72 items-center justify-center bg-surface/50 text-sm text-muted">
          Inget kvitto
        </div>
      )}
    </Card>
  );
}
