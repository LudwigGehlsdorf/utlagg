// A starter Swedish BAS chart of accounts (subset relevant to a student
// section's expenses). Hardcoded for now — can move to a DB model later.
// `number` is the 4-digit BAS account; `name` is the Swedish label.

export interface Account {
  number: string;
  name: string;
}

export const ACCOUNTS: Account[] = [
  // Tillgångar / skulder
  { number: "1930", name: "Företagskonto / sektionskort" },
  { number: "2440", name: "Leverantörsskulder" },
  { number: "2640", name: "Ingående moms" },
  { number: "2890", name: "Skuld till medlem (eget utlägg)" },
  // Kostnader
  { number: "4000", name: "Inköp av varor och material" },
  { number: "5410", name: "Förbrukningsinventarier" },
  { number: "5460", name: "Förbrukningsmaterial" },
  { number: "5810", name: "Resekostnader" },
  { number: "6071", name: "Representation, avdragsgill" },
  { number: "6072", name: "Representation, ej avdragsgill" },
  { number: "6110", name: "Kontorsmateriel" },
  { number: "6150", name: "Trycksaker" },
  { number: "6540", name: "IT-tjänster" },
  { number: "6570", name: "Bankkostnader" },
  { number: "6990", name: "Övriga externa kostnader" },
];

// Frequently used accounts referenced by the default posting logic.
export const ACCOUNT = {
  BANK: "1930",
  MEMBER_DEBT: "2890",
} as const;

export function accountName(number: string): string {
  return ACCOUNTS.find((a) => a.number === number)?.name ?? "";
}
