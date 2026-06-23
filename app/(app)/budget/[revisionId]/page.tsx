import { getCostCenters } from "@/lib/data";
import BudgetRevisionClient from "./revision-client";

export default async function BudgetRevisionPage() {
  const costCenters = await getCostCenters();
  return <BudgetRevisionClient costCenters={costCenters} />;
}
