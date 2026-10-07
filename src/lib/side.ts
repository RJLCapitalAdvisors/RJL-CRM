import type { Workspace } from "@/lib/access";

/**
 * Which of the three CRMs this deployment serves (Jonathan, Oct 7, 2026, when RJL Acquisitions moved to Shawn's own
 * accounts). `CRM_SIDE` is unset on a deployment that serves all three, "AQ" on Shawn's, "CA,IL" on Jonathan's once
 * the Acquisitions pages are retired there. A side that is not served is routed to the served side's home, cannot be
 * signed into, has no tile in the sidebar, and its crons do nothing.
 */
export const SIDES: Workspace[] = (process.env.CRM_SIDE ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((s): s is Workspace => s === "CA" || s === "IL" || s === "AQ");
export const servesSide = (w: Workspace) => SIDES.length === 0 || SIDES.includes(w);
/** The one side a single-side deployment serves, else null. */
export const onlySide = (): Workspace | null => (SIDES.length === 1 ? SIDES[0] : null);
export const sideHome = (w: Workspace) => (w === "AQ" ? "/acquisitions" : w === "IL" ? "/israel" : "/");
