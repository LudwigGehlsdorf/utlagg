import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/types";

// Add our app fields (DB user id + role) to the session and JWT.
declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
  }
}
