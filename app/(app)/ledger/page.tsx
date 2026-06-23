import { getFortnoxStatus } from "@/lib/data";
import LedgerClient from "./ledger-client";

export default async function LedgerPage() {
  const fortnox = await getFortnoxStatus();
  return <LedgerClient fortnox={fortnox} />;
}
