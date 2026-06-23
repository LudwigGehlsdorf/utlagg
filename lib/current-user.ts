// The acting user is the signed-in Auth.js session user (mapped to our DB User
// id during sign-in). Returns null when unauthenticated.
import { auth } from "@/auth";
import { initials } from "@/lib/format";
import type { Role, User } from "@/lib/types";

export async function resolveUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

// The acting user's id + role, or null when unauthenticated.
export async function resolveUser(): Promise<{ id: string; role: Role } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, role: session.user.role };
}

// The full acting user mapped to the UI `User` shape (from the session), for
// Server Component pages that render the current user. Null when unauthenticated.
export async function resolveSessionUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const name = session.user.name ?? session.user.email ?? "Användare";
  return {
    id: session.user.id,
    name,
    email: session.user.email ?? "",
    role: session.user.role,
    initials: initials(name),
  };
}
