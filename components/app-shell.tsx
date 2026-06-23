"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useRole } from "./role-context";
import { NotificationBanners } from "./notifications";
import { Avatar } from "./ui/avatar";
import {
  IconBank,
  IconBook,
  IconCard,
  IconChart,
  IconCheck,
  IconGear,
  IconGrid,
  IconPlus,
  IconReceipt,
} from "./ui/icons";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  roles: Role[];
  cardHolderOnly?: boolean; // only shown to members who hold a section card
};

const ALL: Role[] = ["MEMBER", "APPROVER", "BOOKKEEPER", "ADMIN"];

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Översikt", icon: IconGrid, roles: ALL },
  { href: "/expenses", label: "Utlägg", icon: IconReceipt, roles: ALL },
  { href: "/expenses/new", label: "Nytt utlägg", icon: IconPlus, roles: ALL },
  { href: "/card-purchases", label: "Kortköp", icon: IconCard, roles: ALL, cardHolderOnly: true },
  { href: "/approvals", label: "Att attestera", icon: IconCheck, roles: ["APPROVER", "ADMIN"] },
  { href: "/budget", label: "Budget", icon: IconChart, roles: ["APPROVER", "BOOKKEEPER", "ADMIN"] },
  { href: "/ledger", label: "Utfall", icon: IconChart, roles: ["APPROVER", "BOOKKEEPER", "ADMIN"] },
  { href: "/bookkeeping", label: "Bokföring", icon: IconBook, roles: ["BOOKKEEPER", "ADMIN"] },
  { href: "/bank", label: "Bank & matchning", icon: IconBank, roles: ["BOOKKEEPER", "ADMIN"] },
  { href: "/admin", label: "Inställningar", icon: IconGear, roles: ["ADMIN"] },
];

const ROLE_LABELS: Record<Role, string> = {
  MEMBER: "Medlem",
  APPROVER: "Attestant",
  BOOKKEEPER: "Kassör",
  ADMIN: "Administratör",
};

export function AppShell({
  children,
  holdsCard,
}: {
  children: React.ReactNode;
  holdsCard: boolean;
}) {
  const pathname = usePathname();
  const { role, user } = useRole();
  const items = NAV.filter(
    (i) => i.roles.includes(role) && (!i.cardHolderOnly || holdsCard),
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-background md:flex">
        <div className="flex h-16 items-center gap-2.5 px-6">
          <img src="/symbol_real.svg" alt="D-sektionen" className="h-10" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">D-sektionen</p>
            <p className="text-xs text-muted">Ekonomi</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/expenses/new" &&
                item.href !== "/dashboard" &&
                pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-foreground hover:bg-surface",
                )}
              >
                <Icon className="size-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-5 backdrop-blur-md md:px-8">
          <p className="text-sm text-muted md:hidden">D-sektionen · Ekonomi</p>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted">{ROLE_LABELS[role]}</p>
            </div>
            <Avatar initials={user.initials} />
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="h-9 rounded-full border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-surface"
            >
              Logga ut
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 md:px-8">
          <NotificationBanners />
          {children}
        </main>
      </div>
    </div>
  );
}
