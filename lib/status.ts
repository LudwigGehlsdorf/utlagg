import type { ExpenseStatus, PaymentType } from "./types";

// Single source of truth for how each status looks and reads.
// StatusPill and every other surface pull labels/colours from here so
// the visual language stays uniform.

// An utlägg is editable before it's signed (and not terminal). Used by the
// detail page, the edit page, and the PATCH route.
export const EDITABLE_STATUSES: ExpenseStatus[] = [
  "DRAFT",
  "PENDING_MATCH",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
];

export const isEditable = (status: string): boolean =>
  EDITABLE_STATUSES.includes(status as ExpenseStatus);

// "Attested or further" — once here, only an admin may delete the utlägg.
export const SIGNED_STATUSES: ExpenseStatus[] = ["APPROVED", "BOOKED", "EXPORTED"];

export const isSigned = (status: string): boolean =>
  SIGNED_STATUSES.includes(status as ExpenseStatus);

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "purple";

export const STATUS_META: Record<
  ExpenseStatus,
  { label: string; tone: Tone; description: string }
> = {
  DRAFT: {
    label: "Utkast",
    tone: "neutral",
    description: "Påbörjat men inte inskickat.",
  },
  PENDING_MATCH: {
    label: "Väntar på matchning",
    tone: "warning",
    description: "Ska matchas mot en banktransaktion.",
  },
  PENDING_APPROVAL: {
    label: "Väntar på attest",
    tone: "accent",
    description: "Inskickat – väntar på chefens signatur.",
  },
  CHANGES_REQUESTED: {
    label: "Behöver ändras",
    tone: "danger",
    description: "Återsänt med kommentar.",
  },
  APPROVED: {
    label: "Attesterat",
    tone: "success",
    description: "Signerat och klart för bokföring.",
  },
  BOOKED: {
    label: "Bokfört",
    tone: "purple",
    description: "Konterat – redo att exporteras.",
  },
  EXPORTED: {
    label: "Exporterat",
    tone: "success",
    description: "Skickat till Fortnox.",
  },
};

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  purple: "bg-purple-soft text-purple",
};

export const PAYMENT_META: Record<
  PaymentType,
  { label: string; description: string }
> = {
  CARD: {
    label: "Sektionskort",
    description: "Köp gjort med sektionens kort.",
  },
  REIMBURSEMENT: {
    label: "Eget utlägg",
    description: "Betalt privat – ska återbetalas.",
  },
};
