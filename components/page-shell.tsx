import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

// Standard page wrapper: a consistent title/description/action header, one of
// three content widths, and uniform vertical rhythm between major blocks.
// Every page composes the same way: <PageShell title=… width=…>…</PageShell>.
//
//   form    – single-object forms / focused flows   (narrow)
//   content – settings, reading-oriented lists       (medium)
//   wide    – data tables, dashboards, detail grids  (full, inherits layout cap)
type PageWidth = "form" | "content" | "wide";

const WIDTH: Record<PageWidth, string> = {
  form: "mx-auto max-w-2xl",
  content: "mx-auto max-w-4xl",
  wide: "",
};

export function PageShell({
  title,
  description,
  action,
  width = "wide",
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  width?: PageWidth;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(WIDTH[width], className)}>
      <PageHeader title={title} description={description} action={action} />
      <div className="space-y-6">{children}</div>
    </div>
  );
}
