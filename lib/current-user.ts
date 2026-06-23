// The acting user is the signed-in Auth.js session user (mapped to our DB User
// id during sign-in). Returns null when unauthenticated.
import { auth } from "@/auth";
import type { Role } from "@/lib/types";

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
