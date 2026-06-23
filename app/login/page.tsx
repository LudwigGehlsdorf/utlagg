"use client";

import { signIn } from "next-auth/react";

const DEV_USERS = [
  { email: "elsa.lindqvist@dsek.se", label: "Elsa Lindqvist · Medlem" },
  { email: "oskar.berg@dsek.se", label: "Oskar Berg · Attestant" },
  { email: "ludwig.gehlsdorf@dsek.se", label: "Ludwig Gehlsdorf · Kassör" },
  { email: "maja.holm@dsek.se", label: "Maja Holm · Administratör" },
];

export default function LoginPage() {
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-white shadow-[var(--shadow-card)]">
          D
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          D-sektionens ekonomi
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] text-muted">
          Logga in med ditt sektionskonto för att hantera utlägg, attester och
          bokföring.
        </p>

        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-border bg-background text-sm font-medium transition-colors hover:bg-surface"
        >
          <GoogleMark />
          Fortsätt med Google
        </button>

        <p className="mt-5 text-xs text-muted">
          Endast konton på <span className="font-medium">@dsek.se</span> kan
          logga in.
        </p>

        {isDev && (
          <div className="mt-8 rounded-2xl border border-dashed border-border p-4 text-left">
            <p className="mb-3 text-xs font-medium text-muted">
              Dev-inloggning (endast lokalt)
            </p>
            <div className="space-y-2">
              {DEV_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={() => signIn("dev", { email: u.email, callbackUrl: "/dashboard" })}
                  className="flex h-9 w-full items-center rounded-lg border border-border bg-background px-3 text-sm transition-colors hover:bg-surface"
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
