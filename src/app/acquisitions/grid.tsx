"use client";

import { DataGrid, type GridColumn, type GridRow } from "@/components/data-grid";
import { aqRoleColor, aqStageTone } from "@/lib/acquisitions";
import { updateAqCell } from "./actions";
import { JunkTarget } from "@/components/junk-target";

/** The three Acquisitions list grids, each saving one cell at a time through updateAqCell. Tones for the chip columns are attached here (functions cannot cross from the server page). */
export function AqGrid({ kind, columns, rows, empty, gridId }: { kind: "property" | "company" | "contact"; columns: GridColumn[]; rows: GridRow[]; empty?: string; gridId?: string }) {
  const cols = columns.map((c) => (c.key === "callResult" || c.key === "deal" ? { ...c, tone: aqStageTone } : c.key === "roles" ? { ...c, tone: aqRoleColor } : c));
  // the name opens the ticket and is the one cell that does not edit in place (Jonathan, Sep 22, 2026)
  const linkKey = kind === "property" ? "address" : kind === "company" ? "name" : "fullName";
  // right-click a property's address to send the whole card to junk (Shawn, Sep 23, 2026)
  const linkWrap = kind === "property" ? (row: GridRow, node: React.ReactNode) => <JunkTarget target={{ kind: "property", propertyId: row.id, label: String(row.address ?? "") }} block>{node}</JunkTarget> : undefined;
  return <DataGrid id={`aq-${gridId ?? kind}`} columns={cols} rows={rows} save={(id, key, value) => updateAqCell(kind, id, key, value)} empty={empty} linkKey={linkKey} linkWrap={linkWrap} />;
}
