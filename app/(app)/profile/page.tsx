import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/current-user";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const userId = await resolveUserId();
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, bankClearingNumber: true, bankAccountNumber: true },
      })
    : null;
  if (!user) return null; // the (app) layout already guards auth

  return (
    <ProfileClient
      name={user.name}
      email={user.email}
      clearing={user.bankClearingNumber ?? ""}
      account={user.bankAccountNumber ?? ""}
    />
  );
}
