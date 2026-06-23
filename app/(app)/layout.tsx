import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { DataProvider } from "@/components/data-context";
import { RoleProvider } from "@/components/role-context";
import { getAllData } from "@/lib/data";
import type { User } from "@/lib/types";

// Always render against fresh DB data on a full load.
export const dynamic = "force-dynamic";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const name = session.user.name ?? session.user.email ?? "Användare";
  const currentUser: User = {
    id: session.user.id,
    name,
    email: session.user.email ?? "",
    role: session.user.role,
    initials: initials(name),
  };

  const data = await getAllData();

  return (
    <DataProvider data={data}>
      <RoleProvider user={currentUser}>
        <AppShell>{children}</AppShell>
      </RoleProvider>
    </DataProvider>
  );
}
