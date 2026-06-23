"use client";

import { cn } from "@/lib/utils";
import { SortableHeader, type TableControlState } from "./table-controls";

// One table for every data list. Declare columns; DataTable renders the
// header (sortable where a column has sortValue), sorts by the active column,
// paginates via the shared table-controls, and shows a consistent empty row.
// Pages keep their own <Card>/<FilterBar>/<Pagination> wrappers around it.
export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  // Provide to make the column sortable (header becomes clickable).
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string; // extra classes applied to both <th> and <td>
  hidden?: boolean; // drop the column entirely (e.g. role-dependent)
}

type Controls = Pick<TableControlState, "sortKey" | "sortDir" | "toggleSort" | "paginate">;

const alignCls = (a?: Column<unknown>["align"]) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

export function DataTable<T>({
  columns,
  rows,
  controls,
  rowKey,
  onRowClick,
  empty = "Inga resultat.",
}: {
  columns: Column<T>[];
  rows: T[];
  // When provided, DataTable sorts by the active sortable column and paginates.
  controls?: Controls;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  const cols = columns.filter((c) => !c.hidden);

  let data = rows;
  if (controls?.sortKey) {
    const col = cols.find((c) => c.key === controls.sortKey);
    if (col?.sortValue) {
      const dir = controls.sortDir === "asc" ? 1 : -1;
      const sv = col.sortValue;
      data = [...rows].sort((a, b) => {
        const av = sv(a);
        const bv = sv(b);
        if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
        return dir * String(av).localeCompare(String(bv));
      });
    }
  }
  const pageRows = controls ? controls.paginate(data) : data;

  if (data.length === 0) {
    return <p className="px-5 py-12 text-center text-sm text-muted">{empty}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs font-medium text-muted">
          {cols.map((c) =>
            c.sortValue && controls ? (
              <SortableHeader
                key={c.key}
                sortKey={c.key}
                controls={controls}
                className={cn("px-5 py-3", alignCls(c.align), c.className)}
              >
                {c.header}
              </SortableHeader>
            ) : (
              <th key={c.key} className={cn("px-5 py-3", alignCls(c.align), c.className)}>
                {c.header}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {pageRows.map((row) => (
          <tr
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(onRowClick && "cursor-pointer hover:bg-surface/50")}
          >
            {cols.map((c) => (
              <td key={c.key} className={cn("px-5 py-4", alignCls(c.align), c.className)}>
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
