/** Which business a path belongs to: RJL Israel lives under /israel, RJL Acquisitions under /acquisitions, everything else is RJL Capital Advisors. */
export const isIsraelPath = (p: string) => p === "/israel" || p.startsWith("/israel/");
export const isAcquisitionsPath = (p: string) => p === "/acquisitions" || p.startsWith("/acquisitions/");
export const sideOfPath = (p: string): "CA" | "IL" | "AQ" => (isIsraelPath(p) ? "IL" : isAcquisitionsPath(p) ? "AQ" : "CA");
