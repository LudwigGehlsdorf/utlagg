import { redirect } from "next/navigation";
import { resolveSessionUser } from "@/lib/current-user";
import { getExpenseSummaries } from "@/lib/data";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  const user = await resolveSessionUser();
  if (!user) redirect("/login");
  const expenses = await getExpenseSummaries();
  return <ApprovalsClient expenses={expenses} userId={user.id} role={user.role} />;
}
