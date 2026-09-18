"use client";

import { DataGrid, type GridColumn, type GridRow } from "@/components/data-grid";
import { aqRoleColor, aqStageTone } from "@/lib/acquisitions";
import { updateAqCell } from "./actions";

/** The three Acquisitions list grids, each saving one cell at a time through updateAqCell. Tones for the chip columns are attached here (functions cannot cross from the server page). */
export function AqGrid({ kind, columns, rows, empty }: { kind: "property" | "company" | "contact"; columns: GridColumn[]; rows: GridRow[]; empty?: string }) {
  const cols = columns.map((c) => (c.key === "callResult" ? { ...c, tone: aqStageTone } : c.key === "roles" ? { ...c, tone: aqRoleColor } : c));
  return <DataGrid id={`aq-${kind}`} columns={cols} rows={rows} save={(id, key, value) => updateAqCell(kind, id, key, value)} empty={empty} />;
}
