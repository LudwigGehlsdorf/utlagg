"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCheck, IconLink, IconReceipt, IconSearch } from "@/components/ui/icons";
import { useRole } from "@/components/role-context";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { PAYMENT_META, isEditable, isSigned } from "@/lib/status";
import { formatDate, formatDateTime, formatSEK } from "@/lib/format";
import type { BankTransaction, Expense, FortnoxStatus } from "@/lib/types";

export default function ExpenseDetailClient({
  expense,
  bankTransactions,
  fortnox,
}: {
  expense: Expense | null;
  bankTransactions: BankTransaction[];
  fortnox: FortnoxStatus;
}) {
  const router = useRouter();
  const { role, user } = useRole();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentAction, setCommentAction] = useState<null | "request_changes">(null);
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [matchQuery, setMatchQuery] = useState("");
  const [matching, setMatching] = useState(false);
  const txn = bankTransactions.find((t) => t.id === expense?.matchedTransactionId);

  if (!expense) {
    return (
      <EmptyState
        title="Utlägget hittades inte"
        description="Det kan ha tagits bort eller så är länken fel."
        action={<ButtonLink href="/expenses">Till alla utlägg</ButtonLink>}
      />
    );
  }


  // Role + status drive which actions are offered.
  const canApprove =
    expense.status === "PENDING_APPROVAL" &&
    (role === "ADMIN" ||
      (role === "APPROVER" &&
        expense.allocations.some(
          (a) => a.approverId === user.id && !a.approvedById,
        )));
  const canBook =
    (role === "BOOKKEEPER" || role === "ADMIN") && expense.status === "APPROVED";
  const canExport =
    (role === "BOOKKEEPER" || role === "ADMIN") && expense.status === "BOOKED";
  // A booked voucher can still be amended until it's exported to Fortnox.
  const canEditVerification =
    (role === "BOOKKEEPER" || role === "ADMIN") && expense.status === "BOOKED";
  const canEdit = isEditable(expense.status);
  const submittable = ["DRAFT", "PENDING_MATCH", "CHANGES_REQUESTED"].includes(expense.status);
  const isOwner = expense.submitterName === user.name;
  const canSubmit = submittable && (role === "ADMIN" || (role === "MEMBER" && isOwner));
  const cardNeedsMatch = expense.paymentType === "CARD" && !txn && submittable;
  const canMatch =
    expense.paymentType === "CARD" &&
    submittable &&
    (isOwner || role === "ADMIN");
  // Admin may delete any utlägg; a user may delete their own unless it's
  // attested or further.
  const canDelete = role === "ADMIN" || (isOwner && !isSigned(expense.status));

  const SUCCESS: Record<string, string> = {
    submit: "Inskickat för attest.",
    approve: "Utlägget attesterades.",
    request_changes: "Återsänt med begäran om ändring.",
  };

  async function doTransition(action: string, c?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expense!.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: c }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "" }));
        throw new Error(msg || `Åtgärden misslyckades (${res.status})`);
      }
      setCommentAction(null);
      setComment("");
      setNote(SUCCESS[action] ?? "Klart.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Något gick fel");
    } finally {
      setBusy(false);
    }
  }

  // Export to Fortnox is a real API call (its own route), not a status flip.
  async function doExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expense!.id}/export`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Exporten misslyckades (${res.status})`);
      }
      setNote(
        data.attachWarning
          ? `Exporterat till Fortnox (verifikat ${data.label}), men kvittot kunde inte bifogas.`
          : `Exporterat till Fortnox (verifikat ${data.label}).`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Något gick fel");
    } finally {
      setBusy(false);
    }
  }

  async function doMatch(transactionId: string | null) {
    setMatching(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expense!.id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "" }));
        setError(msg || "Matchningen misslyckades");
        return;
      }
      setMatchQuery("");
      setNote(transactionId ? "Transaktion matchad." : "Matchning borttagen.");
      router.refresh();
    } finally {
      setMatching(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${expense!.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "" }));
        throw new Error(msg || `Kunde inte ta bort (${res.status})`);
      }
      router.push("/expenses");
      router.refresh();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Något gick fel");
    }
  }

  const hasPrimaryAction = canApprove || canBook || canExport || canSubmit;

  return (
    <>
      <PageHeader
        title={expense.title}
        description={`${expense.id} · ${expense.submitterName}`}
        action={<StatusPill status={expense.status} />}
      />

      {note && (
        <div className="mb-5 flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
          <IconCheck className="size-4 shrink-0" />
          {note}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Left column */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Uppgifter" />
            <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail label="Butik" value={expense.merchant} />
              <Detail label="Inköpsdatum" value={formatDate(expense.purchaseDate)} />
              <Detail label="Belopp" value={formatSEK(expense.grossAmount)} />
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] text-muted">Kostnadsfördelning</p>
                <div className="space-y-1.5">
                  {expense.allocations.map((a) => (
                    <div key={a.id} className="rounded-lg bg-surface px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{a.costCenterCode}</span>
                          <span className="ml-1.5 text-muted">{a.costCenterName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <span className="tabular-nums">{formatSEK(a.amount)}</span>
                          {a.approvedById ? (
                            <span className="flex items-center gap-1 text-xs text-success">
                              <IconCheck className="size-3.5" />
                              {a.approvedByName}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">{a.approverName}</span>
                          )}
                        </div>
                      </div>
                      {a.comment && (
                        <p className="mt-1 text-xs italic text-muted">{a.comment}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[13px] text-muted">Betalsätt</p>
                <Tag>{PAYMENT_META[expense.paymentType].label}</Tag>
              </div>
            </CardBody>
          </Card>

          {/* Match info */}
          {expense.paymentType === "CARD" && (
            <Card>
              <CardHeader title="Banktransaktion" />
              <CardBody className="space-y-3">
                {txn ? (
                  <>
                    <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{txn.description}</p>
                        <p className="text-xs text-muted">{formatDate(txn.bookedDate)}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatSEK(txn.amount)}
                      </p>
                    </div>
                    {canMatch && (
                      <button
                        onClick={() => doMatch(null)}
                        disabled={matching}
                        className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline disabled:opacity-40"
                      >
                        Ta bort matchning
                      </button>
                    )}
                  </>
                ) : canMatch ? (
                  <TransactionPicker
                    transactions={bankTransactions.filter(
                      (t) =>
                        !t.matchedExpenseId &&
                        t.cardHolderId === user.id &&
                        Math.abs(t.amount) === expense.grossAmount,
                    )}
                    query={matchQuery}
                    onQueryChange={setMatchQuery}
                    onSelect={(id) => doMatch(id)}
                    disabled={matching}
                  />
                ) : (
                  <p className="text-sm text-muted">Ingen matchning.</p>
                )}
              </CardBody>
            </Card>
          )}

          {/* Verification (voucher), once booked */}
          {expense.verification && (
            <Card>
              <CardHeader
                title="Verifikation"
                subtitle={`${formatDate(expense.verification.date)} · ${expense.verification.description}`}
                action={
                  canEditVerification ? (
                    <ButtonLink
                      href={`/expenses/${expense.id}/book`}
                      variant="secondary"
                      size="sm"
                    >
                      Ändra
                    </ButtonLink>
                  ) : undefined
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-5 py-2 font-medium">Konto</th>
                      <th className="px-2 py-2 text-right font-medium">Debet</th>
                      <th className="px-5 py-2 text-right font-medium">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expense.verification.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border align-top">
                        <td className="px-5 py-2">
                          <span className="font-medium tabular-nums">{l.account}</span>{" "}
                          <span className="text-muted">{l.accountName}</span>
                          {l.costCenterCode && (
                            <span className="text-muted"> · {l.costCenterCode}</span>
                          )}
                          {l.description && (
                            <span className="block text-xs text-muted">{l.description}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {l.debit ? formatSEK(l.debit) : ""}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">
                          {l.credit ? formatSEK(l.credit) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {expense.verification.fortnoxLabel && (
                <div className="border-t border-border px-5 py-3 text-xs text-muted">
                  Exporterad till Fortnox · verifikat{" "}
                  <span className="font-medium text-foreground">
                    {expense.verification.fortnoxLabel}
                  </span>
                </div>
              )}
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader title="Historik" />
            <CardBody>
              <ol className="space-y-5">
                {expense.revisions.map((r, i) => (
                  <li key={r.id} className="flex gap-3.5">
                    <div className="flex flex-col items-center">
                      <span className="mt-0.5 size-2.5 rounded-full bg-accent" />
                      {i < expense.revisions.length - 1 && (
                        <span className="mt-1 w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="-mt-0.5 pb-1">
                      <p className="text-sm font-medium">{r.action}</p>
                      <p className="text-xs text-muted">
                        {r.actor} · {formatDateTime(r.date)}
                      </p>
                      {r.comment && (
                        <p className="mt-1.5 rounded-lg bg-surface px-3 py-2 text-sm">
                          {r.comment}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        {/* Right column — receipt + actions */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Kvitto" />
            <CardBody>
              {expense.receiptId ? (
                <ReceiptViewer
                  receiptId={expense.receiptId}
                  mimeType={expense.receiptMimeType ?? "image/jpeg"}
                  filename={`Kvitto · ${expense.merchant}`}
                  className="h-[40vh] rounded-xl border border-border"
                />
              ) : (
                <div className="flex aspect-[3/4] flex-col items-center justify-center rounded-xl border border-border bg-surface text-muted">
                  <IconReceipt className="size-10" />
                  <p className="mt-2 text-sm font-medium">{expense.merchant}</p>
                  <p className="text-xs">{formatSEK(expense.grossAmount)}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Åtgärder" />
            <CardBody className="space-y-2.5">
              {canSubmit && (
                <>
                  <Button
                    className="w-full"
                    disabled={busy || cardNeedsMatch}
                    onClick={() => doTransition("submit")}
                  >
                    <IconCheck className="size-4" />
                    Skicka in för attest
                  </Button>
                  {cardNeedsMatch && (
                    <p className="text-xs text-warning">
                      Matcha utlägget mot en banktransaktion innan du skickar in.
                    </p>
                  )}
                </>
              )}

              {canApprove && !commentAction && (
                <>
                  <Button
                    className="w-full"
                    disabled={busy}
                    onClick={() => doTransition("approve")}
                  >
                    <IconCheck className="size-4" />
                    Attestera
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy}
                    onClick={() => setCommentAction("request_changes")}
                  >
                    Begär ändring
                  </Button>
                </>
              )}

              {canApprove && commentAction && (
                <div className="space-y-2.5">
                  <label className="block text-[13px] font-medium">Vad behöver ändras?</label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Skriv en kommentar till den som lagt utlägget…"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <div className="flex gap-2.5">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      disabled={busy}
                      onClick={() => {
                        setCommentAction(null);
                        setComment("");
                      }}
                    >
                      Avbryt
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={busy || !comment.trim()}
                      onClick={() => doTransition(commentAction, comment)}
                    >
                      Skicka tillbaka
                    </Button>
                  </div>
                </div>
              )}

              {canBook && (
                <ButtonLink href={`/expenses/${expense.id}/book`} className="w-full">
                  Bokför
                </ButtonLink>
              )}
              {canExport && (
                <>
                  <Button
                    className="w-full"
                    disabled={busy || !fortnox.connected}
                    onClick={doExport}
                  >
                    Exportera till Fortnox
                  </Button>
                  {!fortnox.connected && (
                    <p className="text-xs text-muted">
                      Fortnox är inte anslutet — anslut under Bokföring först.
                    </p>
                  )}
                </>
              )}
              {canEdit && (
                <ButtonLink
                  href={`/expenses/${expense.id}/edit`}
                  className="w-full"
                  variant={hasPrimaryAction ? "secondary" : "primary"}
                >
                  Redigera
                </ButtonLink>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}

              {!hasPrimaryAction && !canEdit && !canDelete && (
                <p className="text-sm text-muted">
                  Inga åtgärder tillgängliga i din roll för det här läget.
                </p>
              )}

              {canDelete && (
                <div className="border-t border-border pt-2.5">
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                      className="h-10 w-full rounded-full border border-border px-5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                    >
                      Ta bort utlägg
                    </button>
                  ) : (
                    <div className="space-y-2.5">
                      <p className="text-sm text-muted">
                        Ta bort utlägget permanent? Detta går inte att ångra.
                      </p>
                      <div className="flex gap-2.5">
                        <Button
                          variant="secondary"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => setConfirmDelete(false)}
                        >
                          Avbryt
                        </Button>
                        <Button
                          variant="danger"
                          className="flex-1"
                          disabled={busy}
                          onClick={doDelete}
                        >
                          Ta bort
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

function TransactionPicker({
  transactions,
  query,
  onQueryChange,
  onSelect,
  disabled,
}: {
  transactions: import("@/lib/types").BankTransaction[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const q = query.toLowerCase();
  const filtered = transactions.filter(
    (t) => !q || t.description.toLowerCase().includes(q),
  );

  const inputCls =
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted/60 focus:border-accent focus:outline-none";

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Välj en transaktion att matcha mot:</p>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          placeholder="Sök transaktion…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className={`${inputCls} pl-9`}
        />
      </div>
      <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {filtered.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => onSelect(t.id)}
              disabled={disabled}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface disabled:pointer-events-none disabled:opacity-40"
            >
              <IconLink className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.description}</p>
                <p className="text-xs text-muted">
                  {formatDate(t.bookedDate)}
                  {t.cardHolderName && <> · {t.cardHolderName}</>}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {formatSEK(t.amount)}
              </p>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-4 text-center text-sm text-muted">
            Inga omatchade transaktioner hittades
          </li>
        )}
      </ul>
    </div>
  );
}
