"use client";

import { createContext, useContext } from "react";
import type { AppData } from "@/lib/data";

// Holds the DB-backed datasets, fetched once on the server (in the app layout)
// and passed in as a prop. Pages read it synchronously via useData().
const Ctx = createContext<AppData | null>(null);

export function DataProvider({
  data,
  children,
}: {
  data: AppData;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
