import { getCards, getCommittees, getCostCenters, getUsers } from "@/lib/data";
import AdminClient from "./admin-client";

export default async function AdminPage() {
  const [costCenters, committees, users, cards] = await Promise.all([
    getCostCenters(),
    getCommittees(),
    getUsers(),
    getCards(),
  ]);
  return (
    <AdminClient
      costCenters={costCenters}
      committees={committees}
      users={users}
      cards={cards}
    />
  );
}
