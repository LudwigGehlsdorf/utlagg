import { redirect } from "next/navigation";
import { resolveSessionUser } from "@/lib/current-user";
import { getExpenseSummaries } from "@/lib/data";
import { ExpensesClient } from "./expenses-client";

export default async function ExpensesPage() {
  const user = await resolveSessionUser();
  if (!user) redirect("/login");
  const expenses = await getExpenseSummaries();
  return <ExpensesClient expenses={expenses} role={user.role} userName={user.name} />;
}
