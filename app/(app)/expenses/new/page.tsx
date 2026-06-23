import { getBankTransactions, getCostCenters } from "@/lib/data";
import NewExpenseClient from "./new-client";

export default async function NewExpensePage() {
  const [costCenters, bankTransactions] = await Promise.all([
    getCostCenters(),
    getBankTransactions(),
  ]);
  return <NewExpenseClient costCenters={costCenters} bankTransactions={bankTransactions} />;
}
