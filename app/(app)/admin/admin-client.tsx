"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/status-pill";
import { useRole } from "@/components/role-context";
import { cn } from "@/lib/utils";
import type {
  Card as SectionCard,
  Committee,
  CommitteePosition,
  CostCenter,
  Role,
  User,
} from "@/lib/types";

const ROLE_LABELS: Record<Role, string> = {
  MEMBER: "Medlem",
  APPROVER: "Attestant",
  BOOKKEEPER: "Kassör",
  ADMIN: "Administratör",
};

const POSITION_LABELS: Record<CommitteePosition, string> = {
  ORDFORANDE: "Ordförande",
  SKATTMASTARE: "Skattmästare",
  VICE_SKATTMASTARE: "Vice skattmästare",
  BOARD: "Styrelseledamot",
};

type Tab = "cost-centers" | "committees" | "cards" | "users";

const TABS: { id: Tab; label: string }[] = [
  { id: "cost-centers", label: "Kostnadsställen" },
  { id: "committees", label: "Kommittéer" },
  { id: "cards", label: "Sektionskort" },
  { id: "users", label: "Användare" },
];

const selectCls =
  "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus-inset disabled:opacity-50";

export default function AdminClient({
  costCenters,
  committees,
  users,
  cards,
}: {
  costCenters: CostCenter[];
  committees: Committee[];
  users: User[];
  cards: SectionCard[];
}) {
  const { role } = useRole();
  const isAdmin = role === "ADMIN";
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("cost-centers");
  const [pending, setPending] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Generic helper: fire a mutation keyed by `key` (to disable that control).
  async function mutate(key: string, url: string, method: string, body: unknown) {
    setPending(key);
    try {
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function syncCostCenters() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/cost-centers/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMsg(data.error ?? "Synk misslyckades");
        return;
      }
      setSyncMsg(
        `Uppdaterade ${data.upserted} kostnadsställen${data.deactivated ? `, inaktiverade ${data.deactivated}` : ""}.`,
      );
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  const approverOptions = users.filter((u) => u.role === "APPROVER" || u.role === "ADMIN");

  return (
    <>
      <PageHeader
        title="Inställningar"
        description="Hantera kostnadsställen, kommittéer, attestanter och behörigheter."
      />

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Kostnadsställen ─────────────────────────────────────────── */}
      {tab === "cost-centers" && (
        <Card>
          <CardHeader
            title="Kostnadsställen"
            subtitle="Hämtas från Fortnox. Endast aktiva går att välja vid nya utlägg."
            action={
              isAdmin ? (
                <Button variant="secondary" size="sm" disabled={syncing} onClick={syncCostCenters}>
                  {syncing ? "Synkar…" : "Synka från Fortnox"}
                </Button>
              ) : undefined
            }
          />
          {syncMsg && <p className="border-b border-border px-6 py-2 text-xs text-muted">{syncMsg}</p>}
          {costCenters.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              Inga kostnadsställen ännu. Synka från Fortnox för att hämta in dem.
            </p>
          ) : (
            <ul>
              {costCenters.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex items-center gap-4 border-b border-border px-6 py-3.5 last:border-0",
                    !c.active && "opacity-55",
                  )}
                >
                  <Tag className="font-semibold">{c.code}</Tag>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    {c.committee && <p className="truncate text-xs text-muted">{c.committee}</p>}
                  </div>
                  {!c.active && <span className="text-xs text-muted">Inaktiv</span>}
                  <select
                    value={c.approverId ?? ""}
                    disabled={!isAdmin || pending === c.id}
                    onChange={(e) =>
                      mutate(c.id, `/api/cost-centers/${c.id}`, "PATCH", {
                        approverId: e.target.value || null,
                      })
                    }
                    className={selectCls}
                  >
                    <option value="">Ingen attestant</option>
                    {approverOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Kommittéer ──────────────────────────────────────────────── */}
      {tab === "committees" && (
        <Card>
          <CardHeader
            title="Kommittéer"
            subtitle="Ansvarig styrelseledamot per kommitté (används för attestpolicyn)."
          />
          {committees.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              Inga kommittéer ännu. Kommittéer kommer från kostnadsställenas gruppering.
            </p>
          ) : (
            <ul>
              {committees.map((c) => (
                <li
                  key={c.committee}
                  className="flex items-center gap-4 border-b border-border px-6 py-3.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.committee}</p>
                    <p className="truncate text-xs text-muted">
                      {c.costCenterCount} kostnadsställe{c.costCenterCount === 1 ? "" : "n"}
                    </p>
                  </div>
                  <select
                    value={c.ownerId ?? ""}
                    disabled={!isAdmin || pending === c.committee}
                    onChange={(e) =>
                      mutate(c.committee, "/api/committees", "PUT", {
                        committee: c.committee,
                        ownerId: e.target.value || null,
                      })
                    }
                    className={selectCls}
                  >
                    <option value="">Ingen ansvarig</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Sektionskort ────────────────────────────────────────────── */}
      {tab === "cards" && (
        <Card>
          <CardHeader
            title="Sektionskort"
            subtitle="Tilldela kort till medlemmar. Innehavaren ser sina okvitterade kortköp."
          />
          <ul>
            {cards.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-4 border-b border-border px-6 py-3.5 last:border-0"
              >
                <Tag className="font-semibold tabular-nums">····{c.last4}</Tag>
                <div className="min-w-0 flex-1" />
                <select
                  value={c.holderId ?? ""}
                  disabled={!isAdmin || pending === c.id}
                  onChange={(e) =>
                    mutate(c.id, `/api/cards/${c.id}`, "PATCH", { holderId: e.target.value || null })
                  }
                  className={selectCls}
                >
                  <option value="">Ingen innehavare</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Användare ───────────────────────────────────────────────── */}
      {tab === "users" && (
        <Card>
          <CardHeader
            title="Användare"
            subtitle="Behörigheter styr åtkomst; position styr attestpolicyn."
          />
          <ul>
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3.5 border-b border-border px-6 py-3.5 last:border-0"
              >
                <Avatar initials={u.initials} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <Tag>{ROLE_LABELS[u.role]}</Tag>
                <select
                  value={u.position ?? ""}
                  disabled={!isAdmin || pending === u.id}
                  onChange={(e) =>
                    mutate(u.id, `/api/users/${u.id}`, "PATCH", { position: e.target.value || null })
                  }
                  className={selectCls}
                >
                  <option value="">Ingen position</option>
                  {(Object.keys(POSITION_LABELS) as CommitteePosition[]).map((p) => (
                    <option key={p} value={p}>
                      {POSITION_LABELS[p]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
