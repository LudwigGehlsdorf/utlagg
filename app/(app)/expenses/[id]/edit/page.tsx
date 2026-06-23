import { getCostCenters, getExpenseSummaries } from "@/lib/data";
import EditExpenseClient from "./edit-client";

export default async function EditExpensePage() {
  const [expenses, costCenters] = await Promise.all([
    getExpenseSummaries(),
    getCostCenters(),
  ]);
  return <EditExpenseClient expenses={expenses} costCenters={costCenters} />;
}
