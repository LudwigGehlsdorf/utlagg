import { getBankTransactions, getCostCenters, getCards } from "@/lib/data";
import { resolveUserId } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import NewExpenseClient from "./new-client";

export default async function NewExpensePage() {
  const userId = await resolveUserId();
  const [costCenters, allTxns, cards, user] = await Promise.all([
    getCostCenters(),
    getBankTransactions(),
    getCards(),
    userId
      ? prisma.user.findUnique({ where: { id: userId }, select: { bankClearingNumber: true, bankAccountNumber: true } })
      : Promise.resolve(null),
  ]);
  // "Sektionskort" (card purchase) is only an option for members who hold a card,
  // and a member may only see / match against purchases on their own card.
  const holdsCard = !!userId && cards.some((c) => c.holderId === userId);
  const bankTransactions = userId ? allTxns.filter((t) => t.cardHolderId === userId) : [];
  return (
    <NewExpenseClient
      costCenters={costCenters}
      bankTransactions={bankTransactions}
      holdsCard={holdsCard}
      payoutClearing={user?.bankClearingNumber ?? ""}
      payoutAccount={user?.bankAccountNumber ?? ""}
    />
  );
}
