import { getBankTransactions } from "@/lib/data";
import BankClient from "./bank-client";

export default async function BankPage() {
  const bankTransactions = await getBankTransactions();
  return <BankClient bankTransactions={bankTransactions} />;
}
