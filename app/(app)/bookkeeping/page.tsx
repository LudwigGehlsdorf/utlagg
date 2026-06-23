import { getExpenseSummaries, getFortnoxStatus } from "@/lib/data";
import BookkeepingClient from "./bookkeeping-client";

export default async function BookkeepingPage() {
  const [expenses, fortnox] = await Promise.all([
    getExpenseSummaries(),
    getFortnoxStatus(),
  ]);
  return <BookkeepingClient expenses={expenses} fortnox={fortnox} />;
}
