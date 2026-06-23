"use client";

import { createContext, useContext } from "react";
import type { Role, User } from "@/lib/types";

interface RoleCtx {
  role: Role;
  user: User;
}

const Ctx = createContext<RoleCtx | null>(null);

// The current user comes from the Auth.js session (resolved in the app layout
// and passed in). `role` is their real role — no more demo switching.
export function RoleProvider({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ role: user.role, user }}>{children}</Ctx.Provider>;
}

export function useRole() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
