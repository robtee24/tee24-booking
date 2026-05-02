"use client";

import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  sortable?: boolean;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  loading?: boolean;
  density?: "comfortable" | "compact";
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSortChange?: (key: string, direction: "asc" | "desc") => void;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  loading,
  density = "comfortable",
  selectable,
  selectedKeys,
  onSelectionChange,
  sortKey,
  sortDirection,
  onSortChange,
}: DataTableProps<T>) {
  const cellPad = density === "compact" ? "px-3 py-2" : "px-4 py-3";

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selectedKeys?.has(rowKey(r)));
  const someSelected = selectable && !allSelected && rows.some((r) => selectedKeys?.has(rowKey(r)));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(rows.map(rowKey)));
    }
  }

  function toggleRow(key: string) {
    if (!onSelectionChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }

  function handleSort(col: Column<T>) {
    if (!col.sortable || !onSortChange) return;
    const nextDir: "asc" | "desc" = sortKey === col.key && sortDirection === "asc" ? "desc" : "asc";
    onSortChange(col.key, nextDir);
  }

  return (
    <div className="overflow-x-auto rounded-apple border border-apple-border bg-white">
      <table className="w-full text-apple-sm">
        <thead>
          <tr className="border-b border-apple-divider bg-apple-fill-secondary text-apple-xs font-medium uppercase tracking-wide text-apple-text-tertiary">
            {selectable && (
              <th className={`${cellPad} w-10`}>
                <input
                  type="checkbox"
                  checked={Boolean(allSelected)}
                  ref={(el) => { if (el) el.indeterminate = Boolean(someSelected); }}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded accent-apple-blue"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={[
                  cellPad,
                  col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                  col.sortable ? "cursor-pointer select-none hover:text-apple-text" : "",
                ].join(" ")}
                onClick={() => handleSort(col)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    sortDirection === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className={`${cellPad} text-center text-apple-text-tertiary`}>
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className={`${cellPad} text-center text-apple-text-tertiary`}>
                {empty ?? "No results"}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              const isSelected = selectedKeys?.has(key);
              return (
                <tr
                  key={key}
                  className={[
                    "border-b border-apple-divider last:border-b-0 transition-colors",
                    onRowClick ? "cursor-pointer hover:bg-apple-fill-secondary" : "",
                    isSelected ? "bg-apple-blue/5" : "",
                  ].join(" ")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td className={`${cellPad}`} onClick={(e) => { e.stopPropagation(); toggleRow(key); }}>
                      <input
                        type="checkbox"
                        checked={Boolean(isSelected)}
                        onChange={() => toggleRow(key)}
                        className="h-4 w-4 rounded accent-apple-blue"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        cellPad,
                        "align-top text-apple-text",
                        col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "",
                      ].join(" ")}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
