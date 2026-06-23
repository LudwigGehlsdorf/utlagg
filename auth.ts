// Auth.js (NextAuth v5) configuration. JWT sessions; the Google identity is
// mapped to our own User table (the source of truth for roles). Restricted to
// the @dsek.se Google Workspace domain. A dev-only credentials provider lets us
// sign in as a seeded user without Google credentials during local development.
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/types";

const DOMAIN = "dsek.se";

const providers: NextAuthConfig["providers"] = [];

// Real Google sign-in (only registered when credentials are configured).
if (process.env.AUTH_GOOGLE_ID) {
  providers.push(
    Google({
      // `hd` nudges Google to the workspace domain; we still verify server-side.
      authorization: { params: { hd: DOMAIN, prompt: "select_account" } },
    }),
  );
}

// Dev-only: sign in as an existing @dsek.se user without Google.
if (process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: {} },
      authorize: (creds) => {
        const email = String(creds?.email ?? "").toLowerCase();
        if (!email.endsWith(`@${DOMAIN}`)) return null;
        return { id: email, email };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  callbacks: {
    // Enforce the workspace domain for Google sign-ins.
    async signIn({ account, profile, user }) {
      if (account?.provider === "google") {
        const email = (profile?.email ?? user?.email ?? "").toLowerCase();
        const hd = (profile as { hd?: string } | undefined)?.hd;
        return hd === DOMAIN || email.endsWith(`@${DOMAIN}`);
      }
      return true; // dev provider — already domain-restricted + dev-only
    },
    // On sign-in, resolve (or auto-provision) our DB user and stamp id + role.
    async jwt({ token, user, account }) {
      if (user?.email) {
        const email = user.email.toLowerCase();
        let dbUser = await prisma.user.findUnique({ where: { email } });
        if (!dbUser && account?.provider === "google") {
          dbUser = await prisma.user.create({
            data: { email, name: user.name ?? email, role: "MEMBER" },
          });
        }
        if (dbUser) {
          token.uid = dbUser.id;
          token.role = dbUser.role;
          token.name = dbUser.name;
          token.email = dbUser.email;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid as string;
        session.user.role = token.role as Role;
        if (token.name) session.user.name = token.name as string;
        if (token.email) session.user.email = token.email as string;
      }
      return session;
    },
  },
});
