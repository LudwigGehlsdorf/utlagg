"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNotify } from "@/components/notifications";
import { PageShell } from "@/components/page-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function ProfileClient({ name, email, clearing: c0, account: a0 }: {
  name: string; email: string; clearing: string; account: string;
}) {
  const notify = useNotify();
  const router = useRouter();
  const [clearing, setClearing] = useState(c0);
  const [account, setAccount] = useState(a0);
  const [saving, setSaving] = useState(false);
  const dirty = clearing !== c0 || account !== a0;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankClearingNumber: clearing, bankAccountNumber: account }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || `Kunde inte spara (${res.status})`);
      }
      notify.success("Profil sparad.");
      router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Något gick fel");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="Min profil" description="Dina uppgifter och kontonummer för utbetalning av utlägg." width="form">
      <Card>
        <CardBody className="space-y-5">
          <dl className="divide-y divide-border rounded-xl border border-border">
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <dt className="text-muted">Namn</dt>
              <dd className="font-medium">{name}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <dt className="text-muted">E-post</dt>
              <dd className="font-medium">{email}</dd>
            </div>
          </dl>

          <div>
            <h2 className="text-base font-semibold">Utbetalningskonto</h2>
            <p className="mt-1 text-sm text-muted">
              Används när kassören betalar ut godkända utlägg du lagt ut för egna pengar.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Clearingnummer">
              <Input value={clearing} placeholder="t.ex. 8327-9" onChange={(e) => setClearing(e.target.value)} />
            </Field>
            <Field label="Kontonummer">
              <Input value={account} placeholder="t.ex. 123 456 789-0" onChange={(e) => setAccount(e.target.value)} />
            </Field>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? "Sparar…" : "Spara"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}
