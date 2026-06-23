// Domain types for the mockup. These mirror the planned Prisma models
// closely enough that the real backend can reuse the same shapes.

export type Role = "MEMBER" | "APPROVER" | "BOOKKEEPER" | "ADMIN";

// Section position (org role), separate from the access Role. Drives the
// forthcoming attest policy.
export type CommitteePosition =
  | "ORDFORANDE"
  | "SKATTMASTARE"
  | "VICE_SKATTMASTARE"
  | "BOARD";

export type PaymentType = "CARD" | "REIMBURSEMENT";

export type ExpenseStatus =
  | "DRAFT"
  | "PENDING_MATCH"
  | "PENDING_APPROVAL"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "BOOKED"
  | "EXPORTED";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  position?: CommitteePosition;
  initials: string;
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  committee?: string;
  approverId?: string;
  approverName: string;
  active: boolean;
}

// A committee (the grouping label on cost centres) and its responsible owner.
export interface Committee {
  committee: string;
  ownerId?: string;
  ownerName?: string;
  costCenterCount: number;
}

export interface CostAllocation {
  id: string;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  approverId?: string;
  approverName: string;
  amount: number; // SEK
  comment?: string;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string; // ISO
}

export interface RevisionEntry {
  id: string;
  actor: string;
  action: string; // human-readable, e.g. "Skapade utlägget"
  comment?: string;
  date: string; // ISO
}

export interface VerificationLine {
  id: string;
  account: string; // BAS account number
  accountName: string;
  description?: string;
  costCenterCode?: string;
  debit: number; // SEK
  credit: number; // SEK
}

export interface Verification {
  date: string; // ISO
  description: string;
  createdBy?: string;
  lines: VerificationLine[];
  fortnoxLabel?: string; // e.g. "A-42" once exported to Fortnox
  exportedAt?: string; // ISO
}

// Status of the org's single Fortnox OAuth connection (no secrets exposed).
export interface FortnoxStatus {
  configured: boolean; // server has client id/secret/redirect configured
  connected: boolean; // a valid OAuth connection is stored
  companyName?: string;
  voucherSeries?: string;
  expiresAt?: string; // ISO — access-token expiry
}

export interface Expense {
  id: string; // e.g. "U-2026-0042"
  title: string;
  submitterName: string;
  allocations: CostAllocation[];
  paymentType: PaymentType;
  status: ExpenseStatus;
  merchant: string;
  purchaseDate: string; // ISO
  grossAmount: number; // SEK, öre not modelled in mock
  currency: string;
  matchedTransactionId?: string;
  receiptId?: string; // newest uploaded receipt, if any
  receiptMimeType?: string; // its stored type (image/jpeg or application/pdf)
  verification?: Verification; // present once booked
  revisions: RevisionEntry[];
}

export interface BankTransaction {
  id: string;
  bookedDate: string; // ISO
  description: string;
  amount: number; // negative = money out
  matchedExpenseId?: string;
  // Section card that made the purchase, if known (from the CSV card number).
  cardLast4?: string;
  cardHolderId?: string;
  cardHolderName?: string;
}

export interface Card {
  id: string;
  last4: string;
  holderId?: string;
  holderName?: string;
  active: boolean;
}
