import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RoleProvider } from "@/components/role-context";
import { NotificationsProvider } from "@/components/notifications";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { resolveSessionUser } from "@/lib/current-user";
import { userHoldsCard } from "@/lib/data";

// Always render against fresh DB data on a full load. Each page loads its own
// data (Server Components); the layout only resolves the session user + chrome.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await resolveSessionUser();
  if (!currentUser) redirect("/login");

  const holdsCard = await userHoldsCard(currentUser.id);

  return (
    <RoleProvider user={currentUser}>
      <NotificationsProvider>
        <ConfirmProvider>
          <AppShell holdsCard={holdsCard}>{children}</AppShell>
        </ConfirmProvider>
      </NotificationsProvider>
    </RoleProvider>
  );
}
