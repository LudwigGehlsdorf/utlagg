import { getCostCenters, getExpense } from "@/lib/data";
import BookExpenseClient from "./book-client";

export default async function BookExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [expense, costCenters] = await Promise.all([
    getExpense(id),
    getCostCenters(),
  ]);
  return <BookExpenseClient expense={expense} costCenters={costCenters} />;
}
