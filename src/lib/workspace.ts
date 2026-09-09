/** Which business a path belongs to: RJL Israel lives under /israel, everything else is RJL Capital Advisors. */
export const isIsraelPath = (p: string) => p === "/israel" || p.startsWith("/israel/");
