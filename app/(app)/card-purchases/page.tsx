import { getBankTransactions, getCards } from "@/lib/data";
import CardPurchasesClient from "./card-purchases-client";

export default async function CardPurchasesPage() {
  const [bankTransactions, cards] = await Promise.all([
    getBankTransactions(),
    getCards(),
  ]);
  return <CardPurchasesClient bankTransactions={bankTransactions} cards={cards} />;
}
