import { Card } from "./ui/card";

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold tracking-tight " +
          (accent ? "text-accent" : "")
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
