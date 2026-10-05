"use client";

import { DataGrid, type GridColumn, type GridRow } from "@/components/data-grid";
import { setRentAction } from "./actions";

const COLUMNS: GridColumn[] = [
  { key: "rentNis", label: "Rent (₪ / month)", type: "number", width: 150, hint: "Asking rent in shekels a month; type it and it saves" },
  { key: "rooms", label: "Rooms", type: "readonly", width: 80 },
  { key: "neighborhood", label: "Neighborhood", type: "readonly", width: 280 },
  { key: "city", label: "City", type: "readonly", width: 180 },
];

/** The rent table: the first column is typed, the rest say which neighborhood and room count the rent is for. */
export function RentsGrid({ rows }: { rows: GridRow[] }) {
  return <DataGrid id="il-rents" columns={COLUMNS} rows={rows} save={(id, key, value) => setRentAction(id, key, value)} empty="No neighborhoods match. Clear the filters, or widen the search." showTools={false} />;
}
