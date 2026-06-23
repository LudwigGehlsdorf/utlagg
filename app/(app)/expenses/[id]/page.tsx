import { getBankTransactions, getExpense, getFortnoxStatus } from "@/lib/data";
import ExpenseDetailClient from "./detail-client";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [expense, bankTransactions, fortnox] = await Promise.all([
    getExpense(id),
    getBankTransactions(),
    getFortnoxStatus(),
  ]);
  return (
    <ExpenseDetailClient
      expense={expense}
      bankTransactions={bankTransactions}
      fortnox={fortnox}
    />
  );
}
