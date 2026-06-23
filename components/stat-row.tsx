// Consistent metric-card row. Auto-fits any number of StatCards to equal-width
// columns so dashboards/summaries line up the same on every page.
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      {children}
    </div>
  );
}
